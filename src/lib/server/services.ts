/**
 * The services in compose.yaml (the database, the mail catcher, the fake providers, Redis): how
 * each one is, as Docker Compose reports it, and starting and stopping them. For the health page
 * under /admin.
 *
 * It asks the `docker` command, in the directory the server was started from. That is where
 * compose.yaml is for `pnpm dev`, `pnpm preview` and `pnpm start`, and Compose finds it there as
 * it does from a terminal, an override file included. A deployment has no compose.yaml and
 * usually no Docker, and the page then says that Compose could not be asked, and why.
 *
 * The status is Compose's, health check included: each service in compose.yaml has one, so
 * "healthy" means the service answered its own check, and not only that its container is up.
 *
 * Commands are run by `execFile`, with no shell between, on a thread of their own (`RUNNER`), and
 * a service is only named in one once Compose has listed it (`isService`). Nothing a form sends
 * can become part of a command.
 */
import { Worker } from 'node:worker_threads';

/** One container, as `docker compose ps --format json` describes it: the fields read here. */
export interface Container {
	Service: string;
	/** running, exited, created, paused, restarting, removing or dead. */
	State: string;
	/** healthy, unhealthy or starting, and empty for a container with no health check. */
	Health: string;
	/** Compose's own words: "Up 21 minutes (healthy)", "Exited (0) 2 minutes ago". */
	Status: string;
	Publishers: { URL: string; PublishedPort: number }[] | null;
}

/** How a service is, in the four ways the page tells apart. */
export type Condition = 'healthy' | 'starting' | 'unhealthy' | 'stopped';

export interface Service {
	name: string;
	condition: Condition;
	/** Compose's words for it, or "Not created" for a service that has no container yet. */
	status: string;
	/** Where it can be reached from this machine, such as "127.0.0.1:5432". */
	ports: string[];
	canStart: boolean;
	canStop: boolean;
	/** Why it cannot be stopped from the page though it is running, where there is a reason. */
	stopWithheld?: string;
}

/** What asking Compose came to: the services, or why they could not be listed. */
export type Listing = { ok: true; services: Service[] } | { ok: false; problem: Problem };

/** A failure of the `docker` command, in a sentence, with what Docker itself said. */
export interface Problem {
	summary: string;
	detail: string;
}

/**
 * The services that cannot be stopped from the page, and why. The database is where the site
 * looks up who is signed in and what their role is, for every request to /admin. Stopped from
 * here, it would leave the administrator who stopped it unable to open the page that starts it
 * again.
 */
const WITHHELD: Readonly<Record<string, string>> = {
	postgres:
		'The site checks who you are against this database, so stopping it would lock you out of this page. Stop it from Docker Desktop or a terminal.'
};

/** Why a service may not be stopped from the page, if it may not. Only its own keys count. */
export function stopWithheldFor(name: string): string | undefined {
	return Object.hasOwn(WITHHELD, name) ? WITHHELD[name] : undefined;
}

/** How long to wait for Compose to list what it has, in milliseconds. */
const LIST_LIMIT = 10_000;
/**
 * How long a started service is given to pass its health check, in seconds. Each one in
 * compose.yaml is checked every second while it starts, and is normally healthy within five.
 * The command itself is given longer, for Compose to create what it needs first.
 */
const START_WAIT = 60;
const START_LIMIT = (START_WAIT + 20) * 1000;
/** Compose gives a container 10 seconds to stop before it kills it. */
const STOP_LIMIT = 30_000;

/** Runs `docker compose` with `args`, and answers with what it printed. */
/**
 * The thread that `docker` is started from, which is not the server's own.
 *
 * Starting a process holds up the thread that starts it until the process exists, and on
 * Windows that is long. Measured: 107 to 217 ms for each `docker` command, during which the
 * server answered nothing at all, to anyone. The health page starts two at once, and the first
 * byte of its data took 178 to 234 ms, against 15 to 19 for /admin, which starts none: the page
 * the administrator had asked for was held back, with the list it had been told not to wait for.
 * Started from here, the wait is this thread's, and the server goes on answering.
 *
 * Its code is a string because it is the whole of what the thread runs, and a file of its own
 * would have to be found again after the build has moved everything. It runs `execFile`, with
 * no shell, and hands back what came of it. It takes Node's modules with `getBuiltinModule`,
 * which works whether Node reads the string as a module or as a script: Node 24 read it as a
 * module, where `require` is not defined.
 */
const RUNNER = `
const { parentPort } = process.getBuiltinModule('node:worker_threads');
const { execFile } = process.getBuiltinModule('node:child_process');
parentPort.on('message', ({ id, args, timeout }) => {
	execFile('docker', args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
		const failure = error && { message: error.message, code: error.code, killed: error.killed, stderr };
		parentPort.postMessage({ id, stdout, failure });
	});
});
`;

/** What the thread has been asked to run and has yet to answer, by the number it was given. */
const pending = new Map<
	number,
	{ resolve: (stdout: string) => void; reject: (failure: unknown) => void }
>();
let asked = 0;
let runner: Worker | undefined;

/** The thread, started the first time it is wanted, and again if it has stopped. */
function runnerThread(): Worker {
	if (runner) return runner;

	const thread = new Worker(RUNNER, { eval: true });
	thread.on('message', ({ id, stdout, failure }) => {
		const call = pending.get(id);
		pending.delete(id);
		// A failure crosses as plain fields, and is an Error again here, as `execFile` gives one.
		if (failure) call?.reject(Object.assign(new Error(failure.message), failure));
		else call?.resolve(stdout);
	});
	// A thread that stopped takes every command it was given with it: each is answered as a
	// failure, and the next command starts a new thread.
	const stopped = (reason: unknown) => {
		if (runner === thread) runner = undefined;
		for (const call of pending.values()) call.reject(reason);
		pending.clear();
	};
	thread.on('error', stopped);
	thread.on('exit', (code) => stopped(new Error(`The thread that runs docker stopped (${code}).`)));
	// The server is what keeps the process alive, and this thread is only there while it is. After
	// the listeners, not before: listening for messages holds the process open again, and measured
	// with `unref` first, a script that had finished never exited.
	thread.unref();

	runner = thread;
	return thread;
}

/** Runs `docker compose` with `args`, and answers with what it printed. */
function compose(args: string[], limit: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const id = (asked += 1);
		pending.set(id, { resolve, reject });
		runnerThread().postMessage({ id, args: ['compose', ...args], timeout: limit });
	});
}

/**
 * Compose's list of containers. One JSON object a line, which is what Compose has printed since
 * 2.21, or one JSON array, which is what it printed before.
 */
export function parseContainers(output: string): Container[] {
	const text = output.trim();
	if (text === '') return [];
	if (text.startsWith('[')) return JSON.parse(text) as Container[];
	return text.split('\n').map((line) => JSON.parse(line) as Container);
}

/**
 * How a container is. A service with none, because it was never created or has been removed, is
 * stopped.
 */
function conditionOf(container: Container | undefined): Condition {
	if (container?.State === 'restarting') return 'starting';
	if (container?.State !== 'running') return 'stopped';
	if (container.Health === 'starting') return 'starting';
	if (container.Health === 'unhealthy') return 'unhealthy';
	return 'healthy';
}

/**
 * Every service compose.yaml defines, with how each is: those without a container as well, which
 * is what a service is after `docker compose down` and what `ps` leaves out.
 *
 * By name. Compose lists its services in no fixed order: asked eight times in a row, it gave
 * three different ones, and the rows of the page changed places between one refresh and the next.
 */
export function describeServices(names: string[], containers: Container[]): Service[] {
	return [...names].sort().map((name) => {
		const container = containers.find((each) => each.Service === name);
		const condition = conditionOf(container);
		const running = condition !== 'stopped';
		const ports = (container?.Publishers ?? [])
			.filter((port) => port.PublishedPort > 0)
			.map((port) => `${port.URL}:${port.PublishedPort}`);
		const stopWithheld = running ? stopWithheldFor(name) : undefined;

		return {
			name,
			condition,
			status: container?.Status || 'Not created',
			// Each address once: Docker lists a port twice where it publishes it on IPv4 and IPv6.
			ports: [...new Set(ports)],
			canStart: !running,
			canStop: running && stopWithheld === undefined,
			...(stopWithheld ? { stopWithheld } : {})
		};
	});
}

/** The names compose.yaml gives its services, in whatever order Compose lists them. */
async function serviceNames(): Promise<string[]> {
	const output = await compose(['config', '--services'], LIST_LIMIT);
	return output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

/**
 * A failure of the `docker` command, said so that the administrator knows what to do next.
 * Docker's own words go with it, since they are what will name the port that is taken or the
 * image that could not be pulled.
 */
export function describeFailure(failure: unknown): Problem {
	const { code, killed, stderr, message } = failure as {
		code?: unknown;
		killed?: boolean;
		stderr?: string;
		message?: string;
	};
	const detail = (stderr || message || String(failure)).trim();

	if (code === 'ENOENT') {
		return { summary: 'The docker command is not installed on this server.', detail };
	}
	if (killed) return { summary: 'Docker did not finish in time.', detail };
	// What the command says when it is there and the engine behind it is not: Docker Desktop is
	// not running. The wording differs between Windows, macOS and Linux; each has one of these.
	if (
		/cannot connect to the docker daemon|error during connect|docker daemon is not running/i.test(
			detail
		)
	) {
		return { summary: 'Docker is not running. Start Docker Desktop, then refresh.', detail };
	}
	if (/no configuration file provided/i.test(detail)) {
		return { summary: 'There is no compose.yaml where this server was started.', detail };
	}
	return { summary: 'Docker could not do that.', detail };
}

/** Every service, and how it is. It does not throw: a failure is part of the answer. */
export async function listServices(): Promise<Listing> {
	try {
		const [names, containers] = await Promise.all([
			serviceNames(),
			compose(['ps', '--all', '--format', 'json'], LIST_LIMIT)
		]);
		return { ok: true, services: describeServices(names, parseContainers(containers)) };
	} catch (failure) {
		return { ok: false, problem: describeFailure(failure) };
	}
}

/** Whether compose.yaml defines a service by this name. */
export async function isService(name: string): Promise<boolean> {
	return (await serviceNames()).includes(name);
}

/**
 * Starts a service, creating its container first if it has none, and waits for it to pass its
 * health check. `up` and not `start`: `start` does nothing for a service with no container, which
 * is the one most in need of starting. It also brings the container into line with compose.yaml,
 * as starting it from a terminal would.
 */
export async function startService(name: string): Promise<void> {
	await compose(
		['up', '--detach', '--wait', '--wait-timeout', String(START_WAIT), name],
		START_LIMIT
	);
}

/** Stops a service's container, and keeps it, with its data, to be started again. */
export async function stopService(name: string): Promise<void> {
	await compose(['stop', name], STOP_LIMIT);
}
