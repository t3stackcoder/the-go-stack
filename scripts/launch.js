/**
 * Brings the whole app up on a developer's machine, built as production runs it: `pnpm launch`.
 *
 * In order, stopping at the first step that fails:
 *
 * 1. Takes every value in .env over what the terminal sets (see `shadowed`).
 * 2. Starts every service in compose.yaml and waits until each one passes its health check.
 * 3. Applies the migrations the database has not had yet (`pnpm db:migrate`).
 * 4. Builds the site (`pnpm build`).
 * 5. Stops every server of this app that is already running, in any terminal: `pnpm dev`,
 *    `pnpm preview`, `pnpm start`, and an earlier `pnpm launch`.
 * 6. Starts the production server and stays attached to it. Its log is printed here, and Ctrl+C
 *    stops it.
 *
 * Nothing is stopped until everything that can fail has worked. A build that does not compile, or
 * a migration the database refuses, leaves whatever was running still running.
 */
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The variables that .env sets and the terminal has already set to something else. Node, Vite and
 * drizzle-kit each keep a variable that is already set and ignore the line in .env, so left alone,
 * every one of these would quietly not be what .env says. The launch puts .env's values first.
 *
 * The case that prompted this: a shell profile written for another project set DATABASE_URL in
 * every terminal, and the migrations went to that project's database. It refused the login, and
 * drizzle-kit exited without a word about why. Had it accepted, this project's tables would have
 * been made there.
 *
 * Names only, never values: DATABASE_URL has a password in it.
 *
 * @param {string} file The text of .env.
 * @param {NodeJS.ProcessEnv} environment
 */
export function shadowed(file, environment) {
	return Object.entries(parseEnv(file))
		.filter(([name, value]) => environment[name] !== undefined && environment[name] !== value)
		.map(([name]) => name);
}

/** The text of .env, or nothing if there is none: the server says for itself what it misses. */
function dotEnv() {
	try {
		return readFileSync(join(ROOT, '.env'), 'utf8');
	} catch (failure) {
		if (/** @type {NodeJS.ErrnoException} */ (failure).code === 'ENOENT') return '';
		throw failure;
	}
}

/**
 * A command line as the checks below compare it: no quotes, forward slashes only, single spaces,
 * and in lower case on Windows, where paths ignore case.
 *
 * @param {string} text
 */
function normalized(text) {
	const plain = text
		.replaceAll('"', '')
		.replaceAll('\\', '/')
		.replace(/\/{2,}/g, '/')
		.replace(/\s+/g, ' ')
		.trim();
	return process.platform === 'win32' ? plain.toLowerCase() : plain;
}

const PROJECT = normalized(ROOT).replace(/\/$/, '');

/** What `pnpm start` hands to Node, read from package.json so that the two cannot drift apart. */
const START = normalized(
	JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.start
).replace(/^node /, '');

/**
 * Which of this app's servers a process is, from its command line, or undefined if it is none of
 * them. The command line is all that every platform will say about another process: Windows has
 * no way to ask for a process's working directory short of reading its memory.
 *
 * - Vite's script inside this project, run for anything but `build` or `optimize`, is the dev or
 *   the preview server. pnpm always runs it by its full path.
 * - This project's server.js by its full path is a production server. Step 5 starts it that way.
 * - The command `pnpm start` runs is a production server too. pnpm passes it on as written, with
 *   a relative `server.js`, and neither it nor any of its parent processes names the project. So
 *   it is known by the command alone, and another project's server started with exactly the same
 *   command would be taken for this one's.
 *
 * @param {string} commandLine
 * @returns {'dev server' | 'preview server' | 'production server' | undefined}
 */
export function serverKind(commandLine) {
	const line = normalized(commandLine);
	if (line.endsWith(` ${START}`)) return 'production server';

	const at = line.indexOf(`${PROJECT}/`);
	if (at === -1) return undefined;
	const inside = line.slice(at + PROJECT.length);

	if (/^\/server\.js( |$)/.test(inside)) return 'production server';

	const vite = inside.match(/^\/\S*\/vite\/bin\/vite\.js( .*)?$/);
	if (!vite) return undefined;
	const args = (vite[1] ?? '').trim().split(' ');
	if (args.includes('build') || args.includes('optimize')) return undefined;
	return args.includes('preview') ? 'preview server' : 'dev server';
}

const exec = promisify(execFile);

/**
 * Every process that might be one of this app's servers, with its command line. On Windows only
 * Node's own: the cmd.exe that pnpm wraps each script in ends in the same command, and stops by
 * itself once the server has.
 *
 * @returns {Promise<{ pid: number, commandLine: string }[]>}
 */
async function processes() {
	if (process.platform === 'win32') {
		const { stdout } = await exec(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				"ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | Select-Object ProcessId, CommandLine)"
			],
			{ windowsHide: true }
		);
		/** @type {{ ProcessId: number, CommandLine: string | null }[]} */
		const listed = JSON.parse(stdout);
		// A process of another user's, or an elevated one, is listed without its command line.
		return listed.map((each) => ({ pid: each.ProcessId, commandLine: each.CommandLine ?? '' }));
	}

	const { stdout } = await exec('ps', ['-A', '-ww', '-o', 'pid=', '-o', 'args=']);
	return stdout.split('\n').flatMap((row) => {
		const found = row.trim().match(/^(\d+) +(.*)$/);
		return found ? [{ pid: Number(found[1]), commandLine: found[2] }] : [];
	});
}

/** @param {number} pid */
function isRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (failure) {
		// EPERM: it is there, and belongs to someone this process may not signal.
		return /** @type {NodeJS.ErrnoException} */ (failure).code === 'EPERM';
	}
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function send(pid, signal) {
	try {
		process.kill(pid, signal);
	} catch (failure) {
		// Gone already, which is what was wanted.
		if (/** @type {NodeJS.ErrnoException} */ (failure).code !== 'ESRCH') throw failure;
	}
}

/**
 * Waits up to `limit` milliseconds for the processes to end, and answers with those that have not.
 *
 * @param {number[]} pids
 * @param {number} limit
 */
async function outlasting(pids, limit) {
	const deadline = Date.now() + limit;
	let left = pids.filter(isRunning);
	while (left.length > 0 && Date.now() < deadline) {
		await sleep(100);
		left = left.filter(isRunning);
	}
	return left;
}

/**
 * Stops the processes and waits until they have ended, so that the ports they held are free.
 *
 * On Windows a signal ends a process at once. Elsewhere SIGTERM lets the production server finish
 * what it is answering, but a page that streams can hold it open for as long as it streams, so a
 * server still running after ten seconds is killed.
 *
 * @param {number[]} pids
 */
async function stopAll(pids) {
	for (const pid of pids) send(pid, 'SIGTERM');
	const stubborn = await outlasting(pids, 10_000);

	for (const pid of stubborn) send(pid, 'SIGKILL');
	const unkillable = await outlasting(stubborn, 5_000);
	if (unkillable.length > 0) {
		throw new Error(`Could not stop process ${unkillable.join(', ')}. Stop it by hand.`);
	}
}

/**
 * Runs a command of this project's, printing its output as it goes, and fails if it does.
 *
 * Through the shell, because pnpm is a .cmd file on Windows, which only the shell can start. Each
 * command is a fixed string written below, so nothing reaches the shell from outside.
 *
 * @param {string} command
 */
function run(command) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, { cwd: ROOT, shell: true, stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code, killedBy) => {
			if (code === 0) resolve(undefined);
			else
				reject(
					new Error(
						`\`${command}\` ${killedBy ? `was ended by ${killedBy}` : `exited with code ${code}`}.`
					)
				);
		});
	});
}

/**
 * One step, announced before it starts. A failure ends the launch, with `hint` as what to do next.
 *
 * @param {string} title
 * @param {() => Promise<unknown>} work
 * @param {string} [hint]
 */
async function step(title, work, hint) {
	console.log(`\n▶ ${title}`);
	try {
		await work();
	} catch (failure) {
		console.error(`\n✗ ${failure instanceof Error ? failure.message : failure}`);
		if (hint) console.error(`  ${hint}`);
		process.exit(1);
	}
}

async function launch() {
	// Every command below inherits this process's environment, so with .env's values put into it,
	// they all run against this app's own services whatever the terminal says.
	const file = dotEnv();
	const names = shadowed(file, process.env);
	Object.assign(process.env, parseEnv(file));
	if (names.length > 0) {
		console.log(
			`\nThis terminal sets ${names.join(', ')} differently from .env. Using .env's ` +
				`${names.length === 1 ? 'value' : 'values'}.`
		);
	}

	await step(
		'Starting the services in compose.yaml',
		// Each service has a health check, and --wait holds until all of them pass it.
		() => run('docker compose up --detach --wait --wait-timeout 120'),
		'Is Docker Desktop running? Nothing else has been changed.'
	);
	await step(
		'Applying migrations',
		() => run('pnpm run db:migrate'),
		// drizzle-kit can fail without printing why. The database logs every refusal.
		'The reason is in the database log: docker compose logs postgres --since 5m. ' +
			'Nothing has been stopped.'
	);
	await step('Building', () => run('pnpm run build'), 'Nothing has been stopped.');

	await step('Stopping the servers of this app that are running', async () => {
		const servers = (await processes()).flatMap(({ pid, commandLine }) => {
			const kind = serverKind(commandLine);
			return kind ? [{ pid, kind }] : [];
		});
		if (servers.length === 0) console.log('None were running.');

		await stopAll(servers.map(({ pid }) => pid));
		for (const { pid, kind } of servers) console.log(`Stopped the ${kind} (process ${pid}).`);
	});

	const port = process.env.PORT || '3000';
	console.log(`\n▶ Starting the production server: http://localhost:${port}\n`);

	// By its full path, which is how the next launch will know it (see serverKind).
	const server = spawn(process.execPath, ['--env-file-if-exists=.env', join(ROOT, 'server.js')], {
		cwd: ROOT,
		stdio: 'inherit'
	});
	server.on('error', (failure) => {
		console.error(`\n✗ The production server could not be started: ${failure.message}`);
		process.exit(1);
	});
	server.on('exit', (code, killedBy) => {
		console.log(
			`\nThe production server stopped (${killedBy ? `ended by ${killedBy}` : `exit code ${code}`}).`
		);
		process.exit(code ?? 1);
	});
}

if (import.meta.main) await launch();
