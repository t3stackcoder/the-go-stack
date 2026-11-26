/**
 * The field a send's key travels in. The helper (./save-form.svelte.ts) adds it to every form it
 * sends, and the server (./server/once.ts) knows a press by it however many times it arrives.
 * No schema names it, so no action is ever handed it.
 */
export const SEND_KEY = '__send';
