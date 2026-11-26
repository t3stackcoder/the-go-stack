// `pnpm launch` stops every process this decides is one of the app's servers, so what these pin is
// that it takes each way of running one for what it is, and leaves alone everything else: a build
// or a test run in this project, and every server of another project's.

import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serverKind, shadowed } from './launch.js';

/** The project's directory, ending in a separator, as the platform writes it. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A path inside the project, written with the platform's separator. */
const inside = (...parts: string[]) => ROOT + parts.join(sep);

/** Vite's script as pnpm's shim runs it: through node_modules/.bin, into the store, doubled slash included. */
const VITE = `${inside('node_modules', '.bin', '')}${sep}..${sep}${['.pnpm', 'vite@8.3.8', 'node_modules', 'vite', 'bin', 'vite.js'].join(sep)}`;

describe('serverKind', () => {
	it('takes Vite run for development or preview for those servers', () => {
		expect(serverKind(`node   "${VITE}" dev`)).toBe('dev server');
		expect(serverKind(`node "${VITE}"`)).toBe('dev server');
		expect(serverKind(`node "${VITE}" --port 5174`)).toBe('dev server');
		expect(serverKind(`node "${VITE}" preview`)).toBe('preview server');
	});

	it('takes this project’s server.js by its full path for a production server', () => {
		expect(
			serverKind(
				`"C:\\Program Files\\nodejs\\node.exe" --env-file-if-exists=.env ${inside('server.js')}`
			)
		).toBe('production server');
	});

	it('takes the command `pnpm start` runs for a production server', () => {
		expect(serverKind('node  --env-file-if-exists=.env server.js')).toBe('production server');
	});

	it('takes the billing worker for one, by its full path and by the command `pnpm billing:worker` runs', () => {
		expect(
			serverKind(
				`"C:\\Program Files\\nodejs\\node.exe" --env-file-if-exists=.env ${inside('scripts', 'billing-worker.js')}`
			)
		).toBe('billing worker');
		expect(serverKind('node  --env-file-if-exists=.env scripts/billing-worker.js')).toBe(
			'billing worker'
		);
	});

	it('leaves alone what this project runs that is not a server', () => {
		expect(serverKind(`node "${VITE}" build`)).toBeUndefined();
		expect(serverKind(`node "${VITE}" optimize`)).toBeUndefined();
		expect(
			serverKind(`node ${inside('node_modules', 'vitest', 'vitest.mjs')} run`)
		).toBeUndefined();
		expect(serverKind('node --env-file-if-exists=.env scripts/seed.js')).toBeUndefined();
		expect(serverKind('node --env-file-if-exists=.env scripts/launch.js')).toBeUndefined();
		expect(serverKind('"node" "C:\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" start')).toBeUndefined();
	});

	it('leaves alone the servers of other projects, a neighbour with a longer name included', () => {
		const neighbour = `${ROOT.replace(/[\\/]$/, '')}-old${sep}`;
		expect(
			serverKind(`node ${neighbour}node_modules${sep}vite${sep}bin${sep}vite.js dev`)
		).toBeUndefined();
		expect(serverKind(`node ${neighbour}server.js`)).toBeUndefined();
		expect(serverKind('node /elsewhere/node_modules/vite/bin/vite.js dev')).toBeUndefined();
		expect(serverKind('node server.js')).toBeUndefined();
	});

	// A shim names the project as the terminal it was run from spelled it, which on Windows need not
	// be the case it has on disk.
	it.runIf(process.platform === 'win32')('ignores case in paths on Windows', () => {
		expect(serverKind(`node "${VITE.toUpperCase()}" dev`)).toBe('dev server');
	});
});

// The terminal's value wins over .env's everywhere this project reads one, so a variable set in both
// is only a problem where the two differ.
describe('shadowed', () => {
	const file = [
		'# The database.',
		'DATABASE_URL=postgres://team:team@127.0.0.1:5432/team_collaborator',
		'SMTP_URL=smtp://127.0.0.1:1025',
		'GOOGLE_CLIENT_ID='
	].join('\n');

	it('names what the terminal sets to something other than .env', () => {
		expect(shadowed(file, { DATABASE_URL: 'postgres://app:app@localhost:5432/app' })).toEqual([
			'DATABASE_URL'
		]);
		// In no particular order: Node's parser does not keep the file's.
		expect(
			shadowed(file, { GOOGLE_CLIENT_ID: 'abc', SMTP_URL: 'smtp://elsewhere:25' }).sort()
		).toEqual(['GOOGLE_CLIENT_ID', 'SMTP_URL']);
	});

	it('passes what the terminal leaves unset, sets to the same, or sets that .env does not', () => {
		expect(
			shadowed(file, {
				DATABASE_URL: 'postgres://team:team@127.0.0.1:5432/team_collaborator',
				GOOGLE_CLIENT_ID: '',
				PORT: '4000'
			})
		).toEqual([]);
		expect(shadowed('', { DATABASE_URL: 'anything' })).toEqual([]);
	});
});
