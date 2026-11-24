// The health page is only as good as its reading of what Compose says. A service read as healthy
// when it is not is the very confusion the page exists to end, and a Stop offered for the
// database would lock its administrator out of the page that starts it again.

import { describe, expect, it } from 'vitest';
import {
	type Container,
	describeFailure,
	describeServices,
	parseContainers,
	stopWithheldFor
} from './services.js';

/** A container as Compose describes one, running and healthy unless told otherwise. */
const container = (service: string, fields: Partial<Container> = {}): Container => ({
	Service: service,
	State: 'running',
	Health: 'healthy',
	Status: 'Up 21 minutes (healthy)',
	Publishers: [{ URL: '127.0.0.1', PublishedPort: 6379 }],
	...fields
});

describe("Compose's list of containers", () => {
	it('is read one object a line, as Compose prints it since 2.21, Windows line endings and all', () => {
		const output = `${JSON.stringify(container('redis'))}\r\n${JSON.stringify(container('mailpit'))}\r\n`;
		expect(parseContainers(output).map((each) => each.Service)).toEqual(['redis', 'mailpit']);
	});

	it('is read as one array, as Compose printed it before that', () => {
		const output = JSON.stringify([container('redis')]);
		expect(parseContainers(output).map((each) => each.Service)).toEqual(['redis']);
	});

	it('is empty when there are no containers at all', () => {
		expect(parseContainers('\n')).toEqual([]);
	});
});

describe('a service', () => {
	const one = (fields: Partial<Container>, name = 'redis') =>
		describeServices([name], [container(name, fields)])[0];

	it('is healthy when its container runs and passes its check, and may be stopped', () => {
		expect(one({})).toMatchObject({ condition: 'healthy', canStart: false, canStop: true });
	});

	it('is healthy when its container runs and has no check to pass', () => {
		expect(one({ Health: '' }).condition).toBe('healthy');
	});

	it('is starting while its check has not yet passed, or while it restarts', () => {
		expect(one({ Health: 'starting' }).condition).toBe('starting');
		expect(one({ State: 'restarting', Health: '' }).condition).toBe('starting');
	});

	it('is unhealthy when it runs and fails its check, and may still be stopped', () => {
		expect(one({ Health: 'unhealthy' })).toMatchObject({ condition: 'unhealthy', canStop: true });
	});

	it.each(['exited', 'created', 'dead'])(
		'is stopped when its container is %s, and may be started',
		(State) => {
			expect(one({ State, Health: '', Status: 'Exited (0) 2 minutes ago' })).toMatchObject({
				condition: 'stopped',
				canStart: true,
				canStop: false
			});
		}
	);

	it('is listed, as stopped, when it has no container, which `docker compose ps` leaves out', () => {
		const [service] = describeServices(['postgres'], []);
		expect(service).toMatchObject({
			name: 'postgres',
			condition: 'stopped',
			status: 'Not created',
			ports: [],
			canStart: true
		});
	});

	it('is listed by name, whatever order Compose gives the services and their containers in', () => {
		const services = describeServices(
			['redis', 'mailpit', 'postgres'],
			[container('postgres'), container('redis'), container('mailpit')]
		);
		expect(services.map((service) => service.name)).toEqual(['mailpit', 'postgres', 'redis']);
	});

	it('shows each address it is published at once, though Docker lists IPv4 and IPv6 apart', () => {
		const ports = [
			{ URL: '0.0.0.0', PublishedPort: 8025 },
			{ URL: '0.0.0.0', PublishedPort: 8025 },
			{ URL: '', PublishedPort: 0 }
		];
		expect(one({ Publishers: ports }).ports).toEqual(['0.0.0.0:8025']);
	});
});

describe('the database', () => {
	it('cannot be stopped from the page, which needs it to know who is asking, and says why', () => {
		const database = describeServices(['postgres'], [container('postgres')])[0];
		expect(database.canStop).toBe(false);
		expect(database.stopWithheld).toMatch(/lock you out/);
	});

	it('can be started from the page when it is down', () => {
		const database = describeServices(
			['postgres'],
			[container('postgres', { State: 'exited' })]
		)[0];
		expect(database).toMatchObject({ canStart: true, canStop: false });
		expect(database.stopWithheld).toBeUndefined();
	});

	it('is the only service held back, and not by a name that is the object’s own', () => {
		expect(stopWithheldFor('redis')).toBeUndefined();
		expect(stopWithheldFor('constructor')).toBeUndefined();
	});
});

describe('a failure of the docker command', () => {
	it('says when the command is not installed', () => {
		const failure = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
		expect(describeFailure(failure).summary).toMatch(/not installed/);
	});

	it('says when Docker Desktop is not running, and keeps what Docker said', () => {
		const stderr =
			'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.';
		const problem = describeFailure(
			Object.assign(new Error('Command failed'), { code: 1, stderr })
		);
		expect(problem.summary).toMatch(/Docker is not running/);
		expect(problem.detail).toBe(stderr);
	});

	it('says when it ran out of time', () => {
		const failure = Object.assign(new Error('Command failed'), { killed: true, stderr: '' });
		expect(describeFailure(failure).summary).toMatch(/in time/);
	});

	it('passes on anything else in Docker’s own words', () => {
		const stderr =
			'Error response from daemon: Bind for 127.0.0.1:6379 failed: port is already allocated';
		const problem = describeFailure(
			Object.assign(new Error('Command failed'), { code: 1, stderr })
		);
		expect(problem).toEqual({ summary: 'Docker could not do that.', detail: stderr });
	});
});
