// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			/**
			 * Set on unexpected errors only: the reference under which the details were recorded,
			 * shown to the visitor so that a report from them can be matched to it.
			 */
			reference?: string;
		}
		interface Locals {
			/**
			 * Who is signed in, or null. Set in src/hooks.server.ts for every request but those
			 * made while the site is being built. The session is looked up the first time this is
			 * called and remembered for the rest of the request, so a page that does not call it
			 * makes no query.
			 */
			session(): Promise<import('#lib/server/auth/index.js').Session | null>;
		}
		interface PageData {
			/**
			 * Set by `streaming` (src/lib/server/streaming.ts): whether the page has late values
			 * still to come, which a visitor without JavaScript would never see arrive.
			 */
			streams?: boolean;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
