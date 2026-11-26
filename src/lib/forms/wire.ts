/**
 * The forms that have been sent and not yet answered, from every form on the page.
 *
 * Kept here and not in the helper (./save-form.svelte.ts) for the sake of one question the
 * browser's error hook asks: whether a form is waiting for its answer. The hook is loaded by
 * every page, and asking the helper would send the helper to every page with it.
 */
const onTheWire = new Set<object>();

/** Called by the helper as a form's request leaves. */
export const sentOff = (send: object) => void onTheWire.add(send);

/** Called by the helper when the request is answered or given up on. Once is enough, twice is harmless. */
export const answered = (send: object) => void onTheWire.delete(send);

/**
 * Whether a form is waiting for its answer. An answer that cannot be read reaches the error
 * hook (src/hooks.client.ts) as an error of unknown kind, and it is the visitor's connection
 * or something in front of the server, and not a fault in the page's code.
 */
export const awaitingAnswer = () => onTheWire.size > 0;
