/**
 * Sends the ledger to Polar: the rows not yet sent, oldest first, a batch at a time.
 *
 * A row is marked sent only after Polar has answered for it. If the worker stops between the
 * two, the batch goes again, and Polar leaves out every event whose id it has seen. So a row is
 * billed once however many times it is sent.
 *
 * Polar bills an event in the period it receives it in, not the one the event happened in, so a
 * row that waits here across the end of a period is billed in the wrong one. That is the reason
 * this runs every second, and once more as the worker stops.
 */
import { and, asc, inArray, isNull } from 'drizzle-orm';
import { record } from '#lib/server/log.js';
import { usageEvent } from '../../db/billing-schema.js';
import { isMeterKey } from '../catalogue.js';
import { isInvalid } from '../polar/client.js';
import type { SyncCalls, UsageToShip } from '../polar/sync.js';
import type { Database } from '../service.js';
import type { Budget } from './budget.js';

/**
 * Events in one request. Polar documents no maximum. Its own SDK sends up to 1,000 at a time,
 * and half of that keeps a request small and still clears 100,000 events a minute within the
 * rate limit.
 */
const BATCH = 500;

export interface ShipDeps {
	db: Database;
	polar: Pick<SyncCalls, 'ingest'>;
	budget: Budget;
}

/**
 * Ships one batch, and answers with how many rows it settled. Nought means there is nothing to
 * send, and the caller can rest. It throws when Polar cannot be reached or says to wait, and the
 * rows are then simply still unsent.
 */
export async function shipOnce({ db, polar, budget }: ShipDeps): Promise<number> {
	const rows = await db
		.select({
			id: usageEvent.id,
			subjectId: usageEvent.subjectId,
			meter: usageEvent.meter,
			units: usageEvent.units,
			recordedAt: usageEvent.recordedAt
		})
		.from(usageEvent)
		.where(and(isNull(usageEvent.shippedAt), isNull(usageEvent.shipError)))
		.orderBy(asc(usageEvent.recordedAt))
		.limit(BATCH);
	if (rows.length === 0) return 0;

	/** Sets a row aside for good. It is recorded, because it is use that will not be billed. */
	async function refuse(ids: string[], reason: string) {
		record('error', 'billing usage refused', { reason, events: ids });
		await db.update(usageEvent).set({ shipError: reason }).where(inArray(usageEvent.id, ids));
	}

	/**
	 * Sends rows to Polar. Polar refuses a whole request for one bad event, without sending the
	 * good ones on, so a refused batch is cut in half and each half sent again, down to the one
	 * event that is at fault. That one is set aside, and every other row still gets through.
	 */
	async function send(batch: UsageToShip[]): Promise<void> {
		await budget.take();
		try {
			const { inserted, duplicates } = await polar.ingest(batch);
			if (inserted + duplicates !== batch.length) {
				// Polar took the request and accounted for a different number of events than it
				// was sent. Nothing here can say which, so it is recorded for a person to look at.
				record('error', 'billing ingest count mismatch', {
					sent: batch.length,
					inserted,
					duplicates
				});
			}
		} catch (error) {
			if (!isInvalid(error)) throw error;
			if (batch.length === 1) {
				return refuse([batch[0].id], 'Polar refused the event as invalid.');
			}
			const half = Math.ceil(batch.length / 2);
			await send(batch.slice(0, half));
			await send(batch.slice(half));
			return;
		}

		await db
			.update(usageEvent)
			.set({ shippedAt: new Date() })
			.where(
				inArray(
					usageEvent.id,
					batch.map((event) => event.id)
				)
			);
	}

	// A row for a meter this code no longer knows cannot be put into Polar's terms.
	const known: UsageToShip[] = [];
	const unknown: string[] = [];
	for (const row of rows) {
		if (isMeterKey(row.meter)) known.push({ ...row, meter: row.meter });
		else unknown.push(row.id);
	}
	if (unknown.length > 0) await refuse(unknown, 'The meter is not in the catalogue.');
	if (known.length > 0) await send(known);

	return rows.length;
}
