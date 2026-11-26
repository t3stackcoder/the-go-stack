/**
 * Who may do what: the three roles, the permissions each one holds, and the check that pages and
 * actions make before they do anything a role decides.
 *
 * Roles are Better Auth's admin plugin's (./index.ts). It keeps each person's role in the `role`
 * column of the user table, gives a new account the default one, and checks its own endpoints
 * against the same roles defined here. A role is a set of permissions, and code asks about the
 * permissions, never the role's name: `can(user, { services: ['control'] })`, not
 * `user.role === 'admin'`. What a role may do is then decided here and nowhere else, and
 * giving powerusers something later is a change to this file.
 *
 * A person is given a role by an administrator, or by `pnpm db:seed` for the first one. Nobody
 * can give themselves one: the plugin does not let the column be written at sign-up or from the
 * account page.
 */
import { error, type RequestEvent, redirect } from '@sveltejs/kit';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { SAID, sentenceFor } from '#lib/auth/messages.js';
import { nextQuery } from '#lib/auth/next.js';

/** Every permission there is, by what it is about. */
const statements = {
	// Better Auth's own, about people and their sessions, which its admin endpoints check.
	...defaultStatements,
	// The pages under /admin. Without this, none of them opens (src/hooks.server.ts).
	adminArea: ['open'],
	// The services in compose.yaml: seeing how each one is, and starting and stopping them.
	services: ['view', 'control']
} as const;

export const ac = createAccessControl(statements);

export const roles = {
	admin: ac.newRole({
		...adminAc.statements,
		adminArea: ['open'],
		services: ['view', 'control']
	}),
	// The same as a user, for now. The role exists so that people can be given it today, and
	// its permissions are added here when the first thing that is theirs is written.
	poweruser: ac.newRole({ ...userAc.statements }),
	user: ac.newRole({ ...userAc.statements })
};

export type Role = keyof typeof roles;

/** The role of a new account, and of one that has none recorded. */
export const DEFAULT_ROLE: Role = 'user';

/** Some of the permissions above: `{ services: ['control'] }`. */
export type Permissions = {
	[Subject in keyof typeof statements]?: (typeof statements)[Subject][number][];
};

/**
 * Whether someone holds every one of `permissions`. The plugin's own rule, so that this site and
 * its endpoints never disagree: the role column may name several roles, comma-separated, and any
 * one of them that holds them all is enough. A role this file does not define holds nothing.
 */
export function can(user: { role?: string | null }, permissions: Permissions): boolean {
	return (user.role || DEFAULT_ROLE)
		.split(',')
		.some(
			(role) => Object.hasOwn(roles, role) && roles[role as Role].authorize(permissions).success
		);
}

/**
 * The session, for a page or an action that only someone with `permissions` may use. It does not
 * return otherwise.
 *
 * A visitor who is not signed in and asked for a page is sent to sign in, and brought back to it
 * after. A form sent by one is answered 401 instead, which ends on the form saying so: their
 * session ended while the page was open, and a redirect would take them off it. Someone who is
 * signed in without the permissions is answered 403.
 */
export async function requirePermission(
	event: Pick<RequestEvent, 'locals' | 'request' | 'url'>,
	permissions: Permissions
) {
	const session = await event.locals.session();
	if (!session) {
		if (event.request.method === 'GET' || event.request.method === 'HEAD') {
			redirect(303, `/sign-in${nextQuery(event.url.pathname + event.url.search)}`);
		}
		error(401, sentenceFor('UNAUTHORIZED'));
	}
	if (!can(session.user, permissions)) error(403, SAID.notAllowed);
	return session;
}
