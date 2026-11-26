/**
 * The calls to Polar that keep the two sides in step: what Polar says about a customer, the
 * usage this site sends it, and a customer taken away. They are the worker's. Nothing that
 * serves a request may import this file: see ./client.ts.
 */
import {
	deleteExternalCustomers,
	getStateExternalCustomers
} from '@polar-sh/sdk/2026-10/services/customers';
import { ingestEvents } from '@polar-sh/sdk/2026-10/services/events';
import { type Catalogue, METER_KEYS, METERS, type MeterKey } from '../catalogue.js';
import { isNotFound, type PolarCore } from './client.js';

/** What Polar says about one customer, in this site's terms. */
export interface Standing {
	/** Whether Polar lists a subscription to the product that is active or on trial. */
	active: boolean;
	productId: string | null;
	periodStart: Date | null;
	periodEnd: Date | null;
	/** By this site's name for each meter that Polar is counting for the customer. */
	meters: Partial<Record<MeterKey, { credited: number; consumed: number }>>;
}

/** One use, as the ledger has it. */
export interface UsageToShip {
	id: string;
	subjectId: string;
	meter: MeterKey;
	units: number;
	recordedAt: Date;
}

export function syncCalls(core: PolarCore, catalogue: Catalogue) {
	return {
		/**
		 * A customer's state, or null for somebody Polar has no customer for.
		 *
		 * Polar lists only subscriptions that are active or on trial. One that is past due, or
		 * cancelled and ended, is simply absent, and so reads here as no subscription. A
		 * subscription to some other product does not count either: it is not what this site sells.
		 *
		 * The period is the subscription's. Polar can be set to bill a meter on a cycle of its
		 * own, shorter than the subscription's, and its state does not say when that cycle turns.
		 * Until this site reads that from somewhere, a product set up that way would have its use
		 * counted here over the wrong period.
		 */
		async customerState(subjectId: string): Promise<Standing | null> {
			let state: Awaited<ReturnType<ReturnType<typeof getStateExternalCustomers>>>;
			try {
				state = await getStateExternalCustomers(core)(subjectId);
			} catch (error) {
				if (isNotFound(error)) return null;
				throw error;
			}

			const subscription = state.active_subscriptions.find(
				(each) => each.product_id === catalogue.productId
			);
			if (!subscription) {
				return { active: false, productId: null, periodStart: null, periodEnd: null, meters: {} };
			}

			const meters: Standing['meters'] = {};
			for (const key of METER_KEYS) {
				const meter = state.active_meters.find((each) => each.meter_id === catalogue.meterIds[key]);
				if (meter) meters[key] = { credited: meter.credited_units, consumed: meter.consumed_units };
			}

			return {
				active: true,
				productId: subscription.product_id,
				periodStart: new Date(subscription.current_period_start),
				periodEnd: new Date(subscription.current_period_end),
				meters
			};
		},

		/**
		 * Sends usage to Polar. Each event carries its ledger id as `external_id`, and Polar
		 * leaves out any it has seen, so a batch sent twice is counted once.
		 *
		 * The timestamp is for show. Polar bills an event in the period it *receives* it in,
		 * whatever time the event says, which is why the worker sends within a second or so.
		 */
		async ingest(events: UsageToShip[]): Promise<{ inserted: number; duplicates: number }> {
			const answer = await ingestEvents(core)({
				events: events.map((event) => ({
					name: METERS[event.meter].eventName,
					external_customer_id: event.subjectId,
					external_id: event.id,
					timestamp: event.recordedAt.toISOString(),
					metadata: { [METERS[event.meter].property]: event.units }
				}))
			});
			return { inserted: answer.inserted, duplicates: answer.duplicates ?? 0 };
		},

		/**
		 * Removes a customer whose account here is gone. Their subscriptions end with them. The
		 * usage already sent stays, because Polar keeps every event it has taken for good. A
		 * customer Polar does not have is already what was wanted.
		 */
		async deleteCustomer(subjectId: string): Promise<void> {
			try {
				await deleteExternalCustomers(core)(subjectId);
			} catch (error) {
				if (!isNotFound(error)) throw error;
			}
		}
	};
}

export type SyncCalls = ReturnType<typeof syncCalls>;
