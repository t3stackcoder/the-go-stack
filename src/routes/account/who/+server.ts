import type { RequestHandler } from './$types';

/**
 * Who is signed in, for the account menu in the header: a name and an address, or `null` for
 * nobody (src/lib/auth/who.svelte.ts asks).
 *
 * Better Auth has an address that answers the same question, and it is switched off
 * (`disabledPaths` in src/lib/server/auth/index.ts), because its answer is the whole session,
 * token included. The token is the session. It is kept in a cookie that script cannot read so
 * that a script which should not be on the page cannot carry it off, and an address that hands
 * it to any script that asks undoes that. This one says what the menu shows and nothing else.
 *
 * Asking is also what puts a stale marker right: `locals.session()` clears it when it finds
 * nobody, and the header goes back to offering a way to sign in.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const session = await locals.session();
	const who = session ? { name: session.user.name, email: session.user.email } : null;

	// Whoever is signed in now, and nobody's to keep a copy of.
	return Response.json(who, { headers: { 'cache-control': 'no-store' } });
};
