import { flushSync } from 'svelte';

export interface UpdateCost {
	/** Distinct DOM nodes changed, anywhere on the page. */
	nodes: number;
	/** From the first assignment to Svelte's last DOM write. */
	ms: number;
}

/**
 * Runs `update` and reports what it cost, measured rather
 * than assumed.
 *
 * The observer watches the whole page, not just the demo, so
 * a write anywhere else would be counted too. The time covers
 * your code and Svelte's. The browser's own style and paint
 * work comes afterwards and is not included: the frame rate
 * is where that shows.
 */
export function measure(update: () => void): UpdateCost {
	// Apply anything already pending, so it is not counted.
	flushSync();

	const observer = new MutationObserver(() => {});
	observer.observe(document.body, {
		subtree: true,
		attributes: true,
		characterData: true,
		childList: true
	});

	const start = performance.now();
	// Svelte normally applies changes in a microtask. This
	// applies them now, while the timer is running.
	flushSync(update);
	const ms = performance.now() - start;

	const records = observer.takeRecords();
	observer.disconnect();

	return { nodes: new Set(records.map((r) => r.target)).size, ms };
}
