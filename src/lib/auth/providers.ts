/**
 * The providers a visitor can sign in with, in the order their buttons stand. Which of them are
 * switched on is the server's to say (src/lib/server/auth/providers.ts); this is what the pages,
 * the server and the build's configuration share about them.
 *
 * `origin` is where each one's own sign-in page is, which is where pressing its button sends
 * the visitor. It is named twice, in places that each refuse anywhere they have not been told
 * of: the content security policy (vite.config.ts), which governs where a form may end up, and
 * the redirect itself, which SvelteKit will not make to another site unasked.
 */
export const PROVIDERS = [
	{ id: 'google', name: 'Google', origin: 'https://accounts.google.com' },
	{ id: 'github', name: 'GitHub', origin: 'https://github.com' },
	{ id: 'facebook', name: 'Facebook', origin: 'https://www.facebook.com' }
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];

/** A provider's name as it is written, or the id of one that is no longer offered. */
export const providerName = (id: string): string =>
	PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
