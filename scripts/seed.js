/**
 * Makes sure there is an administrator: `pnpm db:seed`, after `pnpm db:migrate`.
 *
 * It reads ADMIN_EMAIL and ADMIN_PASSWORD from the environment, which for a developer is .env
 * (see .env.example), and it can be run as often as you like:
 *
 * - With no account at that address, one is made, with that password and the admin role. Its
 *   address is taken as verified: whoever can run this has the database already, and is the
 *   one vouching for it.
 * - With a verified account there already, that account is given the admin role, and its
 *   password is left as it is.
 * - With an unverified one, nothing is done. Anyone can sign up with any address, and until the
 *   link sent to it has been opened, the account's password is whoever signed up's. Made an
 *   administrator, it would hand them the admin area the moment the address's owner verified.
 *
 * It runs the site's own auth configuration, loaded through Vite as the server loads it, so the
 * password is hashed as Better Auth hashes it, the role is held to the roles in
 * src/lib/server/auth/access.ts, and the environment is held to the rules in src/env.ts.
 */
import { createServer } from 'vite';

const email = process.env.ADMIN_EMAIL?.trim();
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
	console.error(
		'Set ADMIN_EMAIL and ADMIN_PASSWORD (in .env, for a developer), then run this again.'
	);
	process.exit(1);
}
// The value .env.example ships with is known to everyone.
if (password.startsWith('replace-me')) {
	console.error(
		'ADMIN_PASSWORD is still the placeholder from .env.example. Give it a value of its own.'
	);
	process.exit(1);
}

const vite = await createServer({
	server: { middlewareMode: true, hmr: false, ws: false },
	appType: 'custom',
	logLevel: 'warn'
});

/** @param {string} path A module of the site's, from the project's root. */
const load = (path) => vite.ssrLoadModule(path);

let failed = false;
try {
	const { auth } = await load('/src/lib/server/auth/index.ts');
	const { can } = await load('/src/lib/server/auth/access.ts');
	const { Email, NewPassword } = await load('/src/lib/server/auth/fields.ts');

	// The site's own rules for an address and a new password, and its own words for each.
	for (const [name, schema, value] of [
		['ADMIN_EMAIL', Email, email],
		['ADMIN_PASSWORD', NewPassword, password]
	]) {
		const checked = schema.safeParse(value);
		if (!checked.success) throw new Error(`${name}: ${checked.error.issues[0].message}`);
	}

	const context = await auth.$context;
	const found = await context.internalAdapter.findUserByEmail(email);

	if (!found) {
		await auth.api.createUser({
			body: { email, password, name: 'Administrator', role: 'admin', data: { emailVerified: true } }
		});
		console.log(`Made ${email} an administrator. Sign in with ADMIN_PASSWORD.`);
	} else if (can(found.user, { adminArea: ['open'] })) {
		console.log(`${email} is an administrator already. Nothing was changed.`);
	} else if (!found.user.emailVerified) {
		throw new Error(
			`${email} has an account whose address has not been verified, so it was not made an ` +
				'administrator. Open the verification link sent to it, or delete the account, and run this again.'
		);
	} else {
		await context.internalAdapter.updateUser(found.user.id, { role: 'admin' });
		console.log(
			`Made the existing account at ${email} an administrator. Its password is unchanged.`
		);
	}
} catch (failure) {
	failed = true;
	console.error(failure instanceof Error ? failure.message : failure);
} finally {
	await vite.close();
}

// The database's pool of connections would keep the process alive for as long as it keeps an idle
// one, which is ten seconds.
process.exit(failed ? 1 : 0);
