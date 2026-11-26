import { defineParams } from '@sveltejs/kit/params';

/**
 * What a part of an address must be for a route to answer it. A route names one of these in its
 * folder: `[mode=authMode]`.
 */
export const params = defineParams({
	/**
	 * The three addresses of the page that signs a visitor in or up, or sends a link to choose a
	 * new password. They are one route, so that moving between them keeps the page, and what has
	 * been typed into it, where it is.
	 */
	authMode: (param) =>
		param === 'sign-in' || param === 'sign-up' || param === 'forgot-password' ? param : undefined
});
