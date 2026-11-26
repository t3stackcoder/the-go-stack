/**
 * How long the page a buyer comes back to from Polar (src/routes/billing/activating) waits for
 * their subscription to be confirmed, and how often it looks.
 *
 * Confirming is the webhook reaching this site and the worker asking Polar, which normally takes
 * about a second. So the page looks once a second, and after half a minute it stops and says
 * that it is taking longer than usual: something is slow or down, and looking more often would
 * not make it sooner.
 *
 * With JavaScript the page keeps the time itself. Without it, each look is a fresh page load,
 * and the page can only know how long it has waited by being told: each load sends the next one
 * to an address that counts the looks so far (`?looked=3`). The count is anybody's to write, and
 * it decides nothing but when this page stops refreshing itself.
 */

/** How often the page looks, in milliseconds. */
export const LOOK_EVERY = 1000;

/** How many looks before the page stops and says it is taking longer than usual. */
export const LOOKS = 30;

/** How many looks a page loaded without JavaScript has had, from its address: 0 to `LOOKS`. */
export function looksSoFar(url: URL): number {
	const looked = Number(url.searchParams.get('looked'));
	return Number.isSafeInteger(looked) && looked > 0 ? Math.min(looked, LOOKS) : 0;
}
