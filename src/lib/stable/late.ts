/**
 * Data that a page does not wait for, as it reaches the page.
 *
 * A server `load` hands it over through `streaming` (src/lib/server/streaming.ts), which decides
 * between two forms for each visitor. The `Streamed` component beside this file shows either.
 */

/**
 * The flag in the address that asks the server to wait for slow data and send the page whole.
 * A page that streams sends a visitor without JavaScript to its own address with this added:
 * streaming hands late values to JavaScript to put on the page, and without it a box would show
 * its placeholder for good.
 */
export const WAIT_FLAG = 'nojs';

/** How slow data ended, for a visitor the server waited for: with its value, or with why not. */
export type Settled<T> = { late: 'arrived'; value: T } | { late: 'failed'; error: App.Error };

/**
 * Slow data on its way to the page: a promise, streamed into the response when it settles, or
 * what it settled as, for a visitor the server waited for.
 */
export type Late<T> = Promise<T> | Settled<T>;
