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
		// interface Locals {}
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
