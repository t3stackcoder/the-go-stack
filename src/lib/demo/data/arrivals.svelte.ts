import { createContext } from 'svelte';

/**
 * When each panel of the streaming demo appeared on screen, measured in the browser.
 *
 * Times are milliseconds since the browser started requesting the page, which is the origin of
 * `performance.now()` on a full page load. A client-side navigation has no such starting point,
 * so after one the times are reported as unmeasured rather than measured from the wrong moment.
 */
export class Arrivals {
	/** Whether this visit began with a full page load. Unknown until hydration. */
	measurable = $state<boolean>();

	/** Panel name to arrival time. */
	times = $state<Record<string, { at: number; failed: boolean }>>({});

	record(name: string, failed = false, at = performance.now()) {
		this.times[name] = { at, failed };
	}
}

export const [getArrivals, setArrivals] = createContext<Arrivals>();

/** When the first content was painted, or `undefined` where the browser does not report it. */
export function firstPaint(): number | undefined {
	return performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
}
