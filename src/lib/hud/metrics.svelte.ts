/**
 * Measurements of the page the visitor is looking at, taken in their browser.
 *
 * Every number the site shows about its own performance comes from here. Nothing is hard-coded,
 * so the claims are checked again on every visit, on the visitor's own device and connection.
 */
interface LayoutShiftEntry extends PerformanceEntry {
	value: number;
	hadRecentInput: boolean;
}

/** An entry from the Event Timing API. `interactionId` is zero for anything but a click, tap or key press. */
interface InteractionEntry extends PerformanceEntry {
	interactionId?: number;
}

/**
 * One page's measurements. Created by the readout itself, and not when this module is loaded, so
 * that a production build, which never renders the readout, has none of this in it.
 */
export class PageMetrics {
	/** Milliseconds from the start of the page load until hydration finished. */
	hydratedAt = $state<number>();

	/** Bytes of JavaScript downloaded so far, as sent over the network (compressed). */
	scriptBytes = $state(0);

	/**
	 * Cumulative layout shift so far. `undefined` where the browser cannot measure it (the Layout
	 * Instability API is Chromium-only), so that "not measured" is never shown as "zero".
	 */
	layoutShift = $state<number>();

	/** Milliseconds the server spent rendering this page, or `undefined` if it was prerendered. */
	serverMs = $state<number>();

	/**
	 * The slowest response so far to a click, tap or key press, in milliseconds: from the input to
	 * the next frame drawn after its handlers ran. `null` until the visitor has done something, and
	 * `undefined` where the browser cannot measure it, so that neither is ever shown as a number.
	 */
	slowestResponse = $state<number | null>();

	/**
	 * Starts measuring, with the moment hydration finished. Called once, by the readout when it
	 * mounts, which is at the end of hydration.
	 */
	start(hydratedAt: number) {
		this.hydratedAt = hydratedAt;

		const [load] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
		this.serverMs = load?.serverTiming.find((timing) => timing.name === 'render')?.duration;

		const resources = new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
				if (/\.js(\?|$)/.test(entry.name)) this.scriptBytes += entry.encodedBodySize;
			}
		});
		resources.observe({ type: 'resource', buffered: true });

		if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
			this.layoutShift = 0;
			const shifts = new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as LayoutShiftEntry[]) {
					// Movement within half a second of the visitor's own input is expected, and the
					// standard metric leaves it out.
					if (!entry.hadRecentInput) this.layoutShift = (this.layoutShift ?? 0) + entry.value;
				}
			});
			shifts.observe({ type: 'layout-shift', buffered: true });
		}

		// Interactions are told apart from hovers and movement by their interaction id, so a browser
		// that reports event timings without ids cannot give this figure either.
		if (
			PerformanceObserver.supportedEntryTypes.includes('event') &&
			'interactionId' in PerformanceEventTiming.prototype
		) {
			this.slowestResponse = null;
			const interactions = new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as InteractionEntry[]) {
					if (!entry.interactionId) continue;
					this.slowestResponse = Math.max(this.slowestResponse ?? 0, entry.duration);
				}
			});
			// `event` entries are only reported from 16 ms up, the lowest threshold the browser allows.
			// (The option is real; TypeScript's description of the browser does not list it yet.)
			// `first-input` reports the first interaction however quick it was, so there is a figure to
			// show as soon as there has been one.
			interactions.observe({ type: 'first-input', buffered: true });
			interactions.observe({
				type: 'event',
				durationThreshold: 16,
				buffered: true
			} as PerformanceObserverInit);
		}
	}
}

export const kilobytes = (bytes: number) => (bytes / 1024).toFixed(1);

/**
 * A response time for display. The browser does not report an interaction quicker than 16 ms
 * unless it was the first, and rounds what it does report to 8 ms, so below that threshold the
 * honest figure is the threshold.
 */
export const responseTime = (ms: number) => (ms < 16 ? '<16 ms' : `${ms.toFixed(0)} ms`);

/** A layout-shift score for display. A real but tiny shift must never be rounded down to look like none. */
export const shiftScore = (shift: number) =>
	shift === 0 ? '0' : shift < 0.001 ? '<0.001' : shift.toFixed(3);
