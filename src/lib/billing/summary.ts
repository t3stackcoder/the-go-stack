/**
 * What the billing page is sent about somebody's subscription: what it shows, already written as
 * it shows it, and nothing more. It is written into the page, so it is kept small (well under a
 * kilobyte, which ./summary.test.ts holds it to) and carries no ids: not the product's, not the
 * person's.
 *
 * The numbers and the date are written out here, on the server, and not in the browser: the
 * server's HTML and the hydrated page then say the same thing, as the account page's times do.
 */

/** What `entitlements` answers (src/lib/server/billing/service.ts), as far as the page reads it. */
interface Entitled<Meter extends string> {
	status: 'none' | 'active';
	periodEnd: Date | null;
	meters: Record<Meter, { consumed: number; limit: number | null }>;
}

export interface MeterSummary {
	key: string;
	label: string;
	used: string;
	/** The most that may be used this period, or null where nothing stops it. */
	limit: string | null;
	/** How much of the limit is used, from 0 to 1, for the bar. Null where there is no limit. */
	share: number | null;
}

export type BillingSummary =
	| { subscribed: false }
	| {
			subscribed: true;
			/** When the period the meters count in ends. In UTC, and saying so. */
			periodEnd: { iso: string; text: string } | null;
			meters: MeterSummary[];
	  };

/** In UTC, as the account page prints a time: the server cannot know the visitor's time zone. */
const UTC = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC',
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** One way of writing a number, the same on the server and in the browser. */
export const count = (units: number) => units.toLocaleString('en-GB');

/** The share of a limit that is used, to a tenth of a per cent: as fine as a bar can show. */
function shareOf(consumed: number, limit: number): number {
	if (limit <= 0) return consumed > 0 ? 1 : 0;
	return Math.round(Math.min(1, Math.max(0, consumed / limit)) * 1000) / 1000;
}

/**
 * The page's summary of somebody's entitlements. `labels` names each meter, and is billing's own
 * list of them (`METERS`), so that a meter with no name cannot be added without the type check
 * saying so.
 */
export function summarize<Meter extends string>(
	entitled: Entitled<Meter>,
	labels: Record<Meter, { label: string }>
): BillingSummary {
	if (entitled.status !== 'active') return { subscribed: false };

	const { periodEnd } = entitled;
	const meters = (Object.keys(entitled.meters) as Meter[]).map((key) => {
		const { consumed, limit } = entitled.meters[key];
		return {
			key,
			label: labels[key].label,
			used: count(consumed),
			limit: limit === null ? null : count(limit),
			share: limit === null ? null : shareOf(consumed, limit)
		};
	});

	return {
		subscribed: true,
		periodEnd: periodEnd && {
			iso: periodEnd.toISOString(),
			text: `${UTC.format(periodEnd)} UTC`
		},
		meters
	};
}
