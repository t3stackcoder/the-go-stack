// Draining is what turns a use Redis allowed into a use the ledger holds, and the ledger is what
// the customer is billed from. Broken, a use is allowed and never billed, or billed twice because
// the worker stopped at the wrong moment and did it again, or one odd entry stops every entry
// behind it. Run against a real Redis stream, where a group, a pending entry and a claim are
// what the server says they are.

import { randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usageEvent } from '../../db/billing-schema.js';
import { reachServices } from '../testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { drainOnce } = await import('./drain.js');
const { USAGE_STREAM } = await import('../redis.js');

const services = await reachServices(13);
afterAll(async () => services?.close());
afterEach(() => vi.restoreAllMocks());

const PERIOD = new Date('2026-11-01T00:00:00Z');
/** When the first entry was added, by Redis's clock. Entries are given ids from here, in order. */
const START = 1_780_000_000_000;

let counter = 0;
const subject = () => `subject-${++counter}`;

describe.skipIf(!services)('draining the usage stream', () => {
	const { redis, db } = services!;
	const drain = () => drainOnce({ redis, db });

	let sequence = 0;
	beforeEach(async () => {
		await redis.flushDb();
		sequence = 0;
	});

	/** Adds an entry as the usage script does, at a stream id of the test's choosing. */
	async function add(
		subjectId: string,
		fields: Partial<{ id: string; m: string; u: string; p: string }> = {}
	) {
		return await addRaw(
			Object.entries({
				id: randomUUIDv7(),
				s: subjectId,
				m: 'api_calls',
				u: '1',
				p: String(PERIOD.getTime()),
				...fields
			}).flat()
		);
	}

	/** Adds an entry with exactly these fields, as a flat list of names and values. */
	const addRaw = (fields: string[]) =>
		redis.sendCommand([
			'XADD',
			USAGE_STREAM,
			`${START + sequence++}-0`,
			...fields
		]) as Promise<string>;

	const rowsOf = (subjectId: string) =>
		db.select().from(usageEvent).where(eq(usageEvent.subjectId, subjectId));

	/** Makes the group, as the first drain does, so that entries added after it are new to it. */
	const ready = async () => expect(await drain()).toBe(0);

	it('writes each entry as a row, in the time Redis added it and the period it was allowed in', async () => {
		await ready();
		const id = subject();
		const eventId = randomUUIDv7();
		const nextPeriod = new Date('2026-12-01T00:00:00Z');
		await add(id, { id: eventId, u: '7' });
		await add(id, { p: String(nextPeriod.getTime()), u: '2' });

		expect(await drain()).toBe(2);

		const rows = (await rowsOf(id)).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			id: eventId,
			recordedAt: new Date(START),
			subjectId: id,
			meter: 'api_calls',
			periodStart: PERIOD,
			units: 7,
			shippedAt: null,
			shipError: null
		});
		expect(rows[1]).toMatchObject({
			recordedAt: new Date(START + 1),
			periodStart: nextPeriod,
			units: 2
		});
	});

	it('leaves the stream empty, with nothing waiting to be taken off', async () => {
		await ready();
		await add(subject());
		await add(subject());

		await drain();

		expect(await redis.xLen(USAGE_STREAM)).toBe(0);
		expect(await redis.xPending(USAGE_STREAM, 'drain')).toMatchObject({ pending: 0 });
		expect(await drain()).toBe(0);
	});

	it('is harmless to do twice: an entry written but not taken off is handed out again and adds no row', async () => {
		await ready();
		const id = subject();
		const eventId = randomUUIDv7();
		await add(id, { id: eventId });
		await drain();

		// What the worker stopping between the write and the take-off leaves behind.
		await add(id, { id: eventId });
		expect(await drain()).toBe(1);

		expect(await rowsOf(id)).toHaveLength(1);
		expect(await redis.xLen(USAGE_STREAM)).toBe(0);
	});

	it('hands out again an entry that was taken and not finished with, once it has waited long enough', async () => {
		await ready();
		const id = subject();
		const entryId = await add(id);
		// Handed out to the worker, which then stopped before taking it off.
		await redis.sendCommand([
			'XREADGROUP',
			'GROUP',
			'drain',
			'worker',
			'STREAMS',
			USAGE_STREAM,
			'>'
		]);
		expect(await drain()).toBe(0);

		// Made to look as if it had been waiting for eleven seconds, which is past the ten.
		await redis.sendCommand([
			'XCLAIM',
			USAGE_STREAM,
			'drain',
			'worker',
			'0',
			entryId,
			'IDLE',
			'11000'
		]);

		expect(await drain()).toBe(1);
		expect(await rowsOf(id)).toHaveLength(1);
	});

	it('takes off an entry it cannot read, says so, and still writes the rest of the batch', async () => {
		await ready();
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const id = subject();
		await add(id);
		// An entry without most of its fields, and one whose units are not a number.
		await addRaw(['id', randomUUIDv7()]);
		await add(id, { u: 'lots' });
		await add(id);

		expect(await drain()).toBe(4);

		expect(await rowsOf(id)).toHaveLength(2);
		expect(await redis.xLen(USAGE_STREAM)).toBe(0);
		const lines = error.mock.calls.map((call) => String(call[0]));
		expect(lines.filter((line) => line.includes('billing usage entry unreadable'))).toHaveLength(2);
	});

	// The ledger's id is a uuid column, and the batch is one insert: an id Postgres will not take
	// would fail every row with it, on every try, and nothing in the batch would ever be written.
	it.each([
		['an id that is not a UUID', { id: 'not-a-uuid' }],
		['a period that is no time at all', { p: 'Infinity' }]
	])(
		'takes off an entry with %s as unreadable, and writes the rest of the batch',
		async (_, fields) => {
			await ready();
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const id = subject();
			await add(id);
			await add(id, fields);
			await add(id);

			expect(await drain()).toBe(3);

			expect(await rowsOf(id)).toHaveLength(2);
			expect(await redis.xLen(USAGE_STREAM)).toBe(0);
			expect(await redis.xPending(USAGE_STREAM, 'drain')).toMatchObject({ pending: 0 });
			const lines = error.mock.calls.map((call) => String(call[0]));
			expect(lines.filter((line) => line.includes('billing usage entry unreadable'))).toHaveLength(
				1
			);
		}
	);

	it('makes the group when there is none, and loses nothing that was added before it', async () => {
		const id = subject();
		await add(id);
		await add(id);

		// The first pass finds no group, and makes one from the stream's beginning.
		expect(await drain()).toBe(0);
		expect(await rowsOf(id)).toHaveLength(0);

		expect(await drain()).toBe(2);
		expect(await rowsOf(id)).toHaveLength(2);
	});

	it('finds nothing to do on a stream with nothing in it', async () => {
		await ready();

		expect(await drain()).toBe(0);
	});
});
