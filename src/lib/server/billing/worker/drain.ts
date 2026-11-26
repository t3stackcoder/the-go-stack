/**
 * Moves usage from Redis to the ledger: each use a request allowed is read from the stream,
 * written to `billing.usage_event`, and only then taken off the stream.
 *
 * Doing it twice is harmless, which is what lets it be simple. An entry that was written but not
 * taken off, because the worker stopped between the two, is handed out again, and the ledger
 * already has a row with its id, so the second write does nothing.
 */

import { record } from '#lib/server/log.js';
import { usageEvent } from '../../db/billing-schema.js';
import { type Redis, USAGE_STREAM } from '../redis.js';
import type { Database } from '../service.js';

const GROUP = 'drain';
/** One worker runs at a time (./main.ts), so one name is enough to read as. */
const CONSUMER = 'worker';
const BATCH = 500;
/**
 * How long an entry may sit handed out and not taken off before it is handed out again, in
 * milliseconds. Well past the time a batch takes to write, so that only a worker that stopped
 * part-way has its entries read twice.
 */
const RECLAIM_AFTER = 10_000;

/** One entry as XREADGROUP hands it out: its id, its fields as a flat list, and two counters. */
type Entry = [id: string, fields: string[] | null, ...rest: unknown[]];

/** The entries in a reply, which is a list of streams under one protocol and a map under the other. */
function entriesOf(reply: unknown): Entry[] {
	if (reply === null || reply === undefined) return [];
	if (Array.isArray(reply)) return (reply[0]?.[1] ?? []) as Entry[];
	return (Object.values(reply as Record<string, unknown>)[0] ?? []) as Entry[];
}

/** The form of a UUID, which is what the ledger's id column holds and nothing else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stream entry as a ledger row, or null if it is not one this code wrote.
 *
 * Every field is checked for what the ledger's column will take, and not only for being there:
 * a batch is one insert, and one value Postgres refuses would fail the whole of it on every try,
 * so that nothing in the batch was ever written.
 */
function rowOf([id, fields]: Entry): typeof usageEvent.$inferInsert | null {
	if (!fields) return null;
	const field: Record<string, string> = {};
	for (let i = 0; i < fields.length; i += 2) field[fields[i]] = fields[i + 1];

	const units = Number(field.u);
	const periodStart = Number(field.p);
	// The first half of a stream id is the time Redis added the entry, in milliseconds.
	const recordedAt = Number(id.split('-')[0]);
	if (
		!UUID.test(field.id ?? '') ||
		!field.s ||
		!field.m ||
		!Number.isSafeInteger(units) ||
		!Number.isSafeInteger(periodStart) ||
		periodStart <= 0
	) {
		return null;
	}

	return {
		id: field.id,
		recordedAt: new Date(recordedAt),
		subjectId: field.s,
		meter: field.m,
		periodStart: new Date(periodStart),
		units
	};
}

/**
 * Drains one batch, and answers with how many entries it took off the stream. Nought means the
 * stream is empty, and the caller can rest.
 */
export async function drainOnce({ redis, db }: { redis: Redis; db: Database }): Promise<number> {
	let reply: unknown;
	try {
		// One call hands out new entries and, with CLAIM, any that were handed out more than
		// RECLAIM_AFTER ago and never taken off. Sent as words because the client's own method
		// for this command does not know CLAIM, which Redis added in 8.4.
		reply = await redis.sendCommand([
			'XREADGROUP',
			'GROUP',
			GROUP,
			CONSUMER,
			'COUNT',
			String(BATCH),
			'CLAIM',
			String(RECLAIM_AFTER),
			'STREAMS',
			USAGE_STREAM,
			'>'
		]);
	} catch (error) {
		// No group yet: this is the first drain, or Redis has lost everything and started
		// again. It is made from the stream's beginning, so nothing already there is skipped.
		if (!(error instanceof Error) || !error.message.startsWith('NOGROUP')) throw error;
		await redis.sendCommand(['XGROUP', 'CREATE', USAGE_STREAM, GROUP, '0', 'MKSTREAM']);
		return 0;
	}

	const entries = entriesOf(reply);
	if (entries.length === 0) return 0;

	const rows: (typeof usageEvent.$inferInsert)[] = [];
	for (const entry of entries) {
		const row = rowOf(entry);
		if (row) rows.push(row);
		// Nothing can be done with it, now or on any later try, so it is taken off with the
		// rest. It is recorded first, because it is a use that was allowed and will not be billed.
		else record('error', 'billing usage entry unreadable', { entry: entry[0] });
	}

	if (rows.length > 0) await db.insert(usageEvent).values(rows).onConflictDoNothing();

	const ids = entries.map(([id]) => id);
	await redis.multi().xAck(USAGE_STREAM, GROUP, ids).xDel(USAGE_STREAM, ids).exec();
	return entries.length;
}
