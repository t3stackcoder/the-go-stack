// A documented demo: this page exists to fail, so that the site can show, and its tests can check,
// what a visitor sees when server code throws. It is linked from the Stability chapter.
export const prerender = false;

export function load() {
	// The sentence below is for the server's log. If it ever appears in a browser, the error hook
	// in src/hooks.server.ts has stopped doing its job, and a test fails.
	throw new Error('The failure demo threw on purpose. No visitor should ever read this sentence.');
}
