import { error, redirect } from '@sveltejs/kit';
import { sentenceFor, tooMany } from '#lib/auth/messages.js';
import { HOME } from '#lib/auth/next.js';
import { callAuth } from '#lib/server/auth/call.js';
import { resolve } from '$app/paths';
import type { RequestHandler } from './$types';

/**
 * Signs the visitor out: the form in the account menu and the one on the account page both post
 * here, the browser's own way, and are sent on to the home page.
 *
 * Only a POST. A link could be followed by anything that follows links, on the visitor's behalf,
 * and SvelteKit checks that a POST was sent from this site before this runs.
 *
 * Better Auth ends the session and clears its cookie, and the marker goes with it
 * (src/lib/server/auth/cookies.ts), so the page the visitor lands on shows them signed out from
 * its first frame. Signing out twice is not an error: the second finds nothing to end.
 */
export const POST: RequestHandler = async (event) => {
	const answer = await callAuth(event, '/sign-out');

	// The visitor asked to be signed out, and must not be shown a page that looks as though they
	// were. What they are told is what stood in the way.
	if (!answer.ok) {
		error(
			answer.status,
			answer.status === 429 ? tooMany(answer.retryAfter) : sentenceFor(answer.code)
		);
	}

	redirect(303, resolve(HOME));
};
