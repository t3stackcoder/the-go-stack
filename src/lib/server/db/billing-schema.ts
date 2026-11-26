/**
 * Billing's two tables, in a schema of their own beside the accounts'.
 *
 * `state` is what Polar last said about each person who has ever had anything to do with billing:
 * whether they subscribe, to what, for which period, and how many units each meter was credited.
 * `usage_event` is the ledger: every unit of metered use this site has allowed, once, for good.
 * The ledger is the record of usage, and Polar is sent a copy. Polar is the record of everything
 * about money, and `state` is this site's copy of the part it needs.
 *
 * Requests read and count in Redis (src/lib/server/billing/index.ts). They read these two only
 * to put back what Redis does not have, the first time it is wanted, or because Redis cannot be
 * reached. The worker writes both (src/lib/server/billing/worker). A request writes one thing:
 * the mark on a buyer's row, from the page they wait on after paying.
 *
 * A subject is whoever is billed: today an account, by its id. Nothing here refers to the user
 * table, so that billing an organisation later is new rows and not a new shape.
 */
import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const billing = pgSchema('billing');

export const billingState = billing.table(
	'state',
	{
		/** The account's id, which is also the customer's `external_id` at Polar. */
		subjectId: text('subject_id').primaryKey(),
		/**
		 * Goes up by one each time anything below it changes. The copy in Redis carries it, and
		 * is only ever replaced by a later one, so two writers cannot put an old state over a new.
		 */
		version: bigint('version', { mode: 'number' }).notNull().default(0),
		/** `active` while Polar lists a subscription that is active or on trial, and `none` otherwise. */
		status: text('status', { enum: ['none', 'active'] })
			.notNull()
			.default('none'),
		productId: text('product_id'),
		/** The subscription's current period. Usage is counted, and limited, within it. */
		periodStart: timestamp('period_start', { withTimezone: true }),
		periodEnd: timestamp('period_end', { withTimezone: true }),
		/** Units credited for the period, by this site's name for each meter: `{ "api_calls": 1000 }`. */
		credits: jsonb('credits').$type<Record<string, number>>().notNull().default({}),
		/**
		 * When something last suggested this row is out of date: a webhook that named the person.
		 * The worker asks Polar for the state of every row that has one, and clears it only if it
		 * is still the value it saw, so a webhook that arrives mid-question is not lost.
		 */
		dirtyAt: timestamp('dirty_at', { withTimezone: true }),
		/** When Polar was last asked. Null for a row a webhook has just made. */
		syncedAt: timestamp('synced_at', { withTimezone: true })
	},
	(table) => [
		// The worker's first question on each pass, "whom has something marked?", is a walk of
		// this small index. Its other one, "which subscriber has not been asked about for a
		// while?", has to read every row, and is put about once a minute
		// (src/lib/server/billing/worker/sync.ts).
		index('state_dirty').on(table.dirtyAt).where(sql`${table.dirtyAt} is not null`)
	]
);

export const usageEvent = billing.table(
	'usage_event',
	{
		/**
		 * Made as the use is allowed (a UUIDv7, so new rows land together in the index), and sent
		 * to Polar as the event's `external_id`. Polar ignores an id it has seen, so sending a
		 * batch twice counts it once, and so does draining the same stream entry twice into here.
		 */
		id: uuid('id').primaryKey(),
		/** Redis's clock, from the stream entry's id. Never this database's: a replay must agree. */
		recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
		subjectId: text('subject_id').notNull(),
		meter: text('meter').notNull(),
		/** The period the use was allowed in, which is the one it counted against. */
		periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
		units: bigint('units', { mode: 'number' }).notNull(),
		shippedAt: timestamp('shipped_at', { withTimezone: true }),
		/** Set when Polar refused the event as invalid. It is then never sent again. */
		shipError: text('ship_error')
	},
	(table) => [
		// What is still to send, oldest first. It holds only that, so it stays a few pages long
		// however large the ledger grows.
		index('usage_event_unshipped')
			.on(table.recordedAt)
			.where(sql`${table.shippedAt} is null and ${table.shipError} is null`),
		// A person's use in one period, added up: asked when Redis has lost its count.
		index('usage_event_period').on(table.subjectId, table.periodStart, table.meter)
	]
);
