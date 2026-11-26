// Who may do what. A mistake here is invisible on every page until somebody is let into one they
// should not be, or kept out of one they should not, so each role is held to what it is meant to
// have.

import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { SAID } from '#lib/auth/messages.js';
import { can, requirePermission } from './access.js';

describe('the roles', () => {
	it('let an admin into the admin area, to see the services and to start and stop them', () => {
		const admin = { role: 'admin' };
		expect(can(admin, { adminArea: ['open'] })).toBe(true);
		expect(can(admin, { services: ['view', 'control'] })).toBe(true);
		// And Better Auth's own: managing people, which its admin endpoints check.
		expect(can(admin, { user: ['list', 'set-role', 'ban'] })).toBe(true);
	});

	it.each(['poweruser', 'user'])('give a %s none of that', (role) => {
		expect(can({ role }, { adminArea: ['open'] })).toBe(false);
		expect(can({ role }, { services: ['view'] })).toBe(false);
		expect(can({ role }, { user: ['list'] })).toBe(false);
	});

	it('treat an account with no role recorded as a user', () => {
		expect(can({ role: null }, { adminArea: ['open'] })).toBe(false);
		expect(can({}, { services: ['view'] })).toBe(false);
	});

	it('take any one of several roles, comma-separated, as Better Auth does', () => {
		expect(can({ role: 'user,admin' }, { services: ['control'] })).toBe(true);
	});

	it('give nothing to a role that is not defined, whatever it is called', () => {
		expect(can({ role: 'root' }, { adminArea: ['open'] })).toBe(false);
		expect(can({ role: 'constructor' }, { adminArea: ['open'] })).toBe(false);
	});
});

describe('a page or action that needs a permission', () => {
	/** A request as `requirePermission` sees one, from someone with `role`, or from nobody. */
	function visit(role: string | null | undefined, method = 'GET') {
		const session = role === undefined ? null : { user: { role } };
		return {
			locals: { session: async () => session },
			request: new Request('http://localhost/admin/health?view=all', { method }),
			url: new URL('http://localhost/admin/health?view=all')
		} as unknown as Parameters<typeof requirePermission>[0];
	}

	/** What `requirePermission` threw, or undefined if it returned. */
	async function outcome(event: Parameters<typeof requirePermission>[0]) {
		try {
			await requirePermission(event, { services: ['view'] });
		} catch (thrown) {
			return thrown;
		}
	}

	it('goes ahead for someone who holds it', async () => {
		expect(await outcome(visit('admin'))).toBeUndefined();
	});

	it('sends a visitor who is not signed in to sign in, and back here after', async () => {
		const thrown = await outcome(visit(undefined));
		expect(isRedirect(thrown) && thrown.location).toBe(
			`/sign-in?next=${encodeURIComponent('/admin/health?view=all')}`
		);
	});

	it('answers a form sent by a visitor who is not signed in with 401, which ends on the form', async () => {
		const thrown = await outcome(visit(undefined, 'POST'));
		expect(isHttpError(thrown) && thrown.status).toBe(401);
	});

	it('turns away someone signed in without it', async () => {
		const thrown = await outcome(visit('user'));
		expect(isHttpError(thrown) && thrown.status).toBe(403);
		expect(isHttpError(thrown) && thrown.body.message).toBe(SAID.notAllowed);
	});
});
