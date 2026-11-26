// What these scripts decide is who may use what they have paid for, and nothing may come between
// reading a count and changing it. Broken, somebody is let past their limit, or is refused for a
// use that was already counted, or is billed twice for one retried request. So they run here in
// a real Redis, where atomicity is a property of the server and not of anything a test could
// pretend: a mock would agree with whatever the script was meant to do.

import { randomUUIDv7 } from 'node:crypto';
import { type AddressInfo, createServer } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reachServices } from './testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const {
	USAGE_STREAM,
	SUBJECT_TTL,
	eventKey,
	hydrateScript,
	openRedis,
	readSubject,
	recordUsageScript,
	setEntitlementsScript,
	subjectKey
} = await import('./redis.js');
type StoredEntitlements = import('./redis.js').StoredEntitlements;

const services = await reachServices(11);
afterAll(async () => services?.close());

const PERIOD = new Date('2026-11-01T00:00:00Z');
const NEXT_PERIOD = new Date('2026-12-01T00:00:00Z');

let counter = 0;
/** A subject nobody else in this file has used. */
const subject = () => `subject-${++counter}`;

const active = (
	version: number,
	limits: Record<string, number> = { api_calls: 10 },
	periodStart: Date | null = PERIOD
): StoredEntitlements => ({
	version,
	status: 'active',
	productId: 'product',
	periodStart,
	periodEnd: new Date('2027-01-01T00:00:00Z'),
	limits
});

const none = (version: number): StoredEntitlements => ({
	version,
	status: 'none',
	productId: null,
	periodStart: null,
	periodEnd: null,
	limits: {}
});

// Needs no Redis: it is about there being none.
describe('a Redis that cannot be reached', () => {
	// Losing the connection is recorded, once, and that line is not what is being looked at.
	beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
	afterEach(() => vi.restoreAllMocks());

	/** An address on this machine that nothing is listening at. */
	async function nothingListening() {
		const server = createServer().listen(0, '127.0.0.1');
		await new Promise((resolve) => server.once('listening', resolve));
		const { port } = server.address() as AddressInfo;
		await new Promise((resolve) => server.close(resolve));
		return `redis://127.0.0.1:${port}`;
	}

	const timed = async (work: () => Promise<unknown>) => {
		const started = performance.now();
		await work().catch(() => {});
		return performance.now() - started;
	};

	it('is waited for once, briefly, and from then on not at all', async () => {
		// Each request used to wait a full second, for as long as Redis was down: a billing page
		// took a second longer every time it was opened, and the page a buyer waits on looks
		// once a second.
		const { redis, close } = openRedis(await nothingListening());
		try {
			await expect(redis()).rejects.toThrow('Redis cannot be reached.');

			expect(await timed(redis)).toBeLessThan(100);
			expect(await timed(() => Promise.all(Array.from({ length: 50 }, redis)))).toBeLessThan(100);
		} finally {
			await close();
		}
	});

	it('leaves nothing behind for each request that found it down', async () => {
		// One listener a request was left on the client, and Node said so at the eleventh.
		const warnings: string[] = [];
		const heard = (warning: Error) => warnings.push(warning.name);
		process.on('warning', heard);
		const { redis, close } = openRedis(await nothingListening());
		try {
			// Together, and before the first try has failed, which is when they all wait.
			await Promise.allSettled(Array.from({ length: 30 }, redis));
			await new Promise((resolve) => setImmediate(resolve));

			expect(warnings).not.toContain('MaxListenersExceededWarning');
		} finally {
			process.off('warning', heard);
			await close();
		}
	});
});

describe.skipIf(!services)("billing's scripts in Redis", () => {
	const { redis } = services!;

	beforeEach(async () => {
		await redis.flushDb();
	});

	/** A subject that is entitled, with this period's counts loaded as `consumed`. */
	async function entitled(limit: number | null, consumed = 0, version = 1) {
		const id = subject();
		await setEntitlementsScript(
			redis,
			id,
			active(version, limit === null ? {} : { api_calls: limit })
		);
		await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: consumed });
		return id;
	}

	const use = (subjectId: string, units = 1, eventId: string = randomUUIDv7()) =>
		recordUsageScript(redis, { subjectId, meter: 'api_calls', units, eventId });

	const counted = async (subjectId: string) =>
		Number((await redis.hGet(subjectKey(subjectId), 'c:api_calls')) ?? 0);

	describe('allowing a use', () => {
		it('says MISS when there is no hash, so that the caller can put it back from Postgres', async () => {
			expect(await use(subject())).toEqual({ answer: 'MISS' });
		});

		it('refuses as inactive for somebody with no subscription', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, none(1));

			expect(await use(id)).toEqual({ answer: 'DENY', reason: 'inactive', remaining: 0 });
			expect(await redis.xLen(USAGE_STREAM)).toBe(0);
		});

		it('says COLD, with the period, for a subscriber whose counts are not loaded yet', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(1));

			expect(await use(id)).toEqual({ answer: 'COLD', periodStart: PERIOD.getTime() });
		});

		it('allows once the counts are loaded, with what is left after this use', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(1, { api_calls: 10 }));
			await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: 3 });

			expect(await use(id, 2)).toEqual({ answer: 'OK', remaining: 5 });
			expect(await counted(id)).toBe(5);
		});

		it('writes the use to the stream with who, what, how much and which period', async () => {
			const id = await entitled(10);
			const eventId = randomUUIDv7();
			await use(id, 4, eventId);

			const entries = await redis.xRange(USAGE_STREAM, '-', '+');
			expect(entries).toHaveLength(1);
			expect(entries?.[0].message).toEqual({
				id: eventId,
				s: id,
				m: 'api_calls',
				u: '4',
				p: String(PERIOD.getTime())
			});
		});
	});

	describe('the limit', () => {
		it('lets a use land exactly on it, and refuses one more unit with what is left', async () => {
			const id = await entitled(5);

			expect(await use(id, 5)).toEqual({ answer: 'OK', remaining: 0 });
			expect(await use(id, 1)).toEqual({ answer: 'DENY', reason: 'limit', remaining: 0 });
		});

		it('says how much is left when a use is too big, and still allows what does fit', async () => {
			const id = await entitled(5, 3);

			expect(await use(id, 3)).toEqual({ answer: 'DENY', reason: 'limit', remaining: 2 });
			expect(await use(id, 2)).toEqual({ answer: 'OK', remaining: 0 });
		});

		it('adds nothing to the stream or the count for a use it refuses', async () => {
			const id = await entitled(5, 4);
			await use(id, 2);

			expect(await redis.xLen(USAGE_STREAM)).toBe(0);
			expect(await counted(id)).toBe(4);
		});

		it('never refuses a meter that has no limit, and says there is none', async () => {
			const id = await entitled(null);

			expect(await use(id, 1_000_000)).toEqual({ answer: 'OK', remaining: null });
			expect(await counted(id)).toBe(1_000_000);
		});
	});

	describe('a second try with the same event id', () => {
		it('is a DUP, and is not counted or put in the stream again', async () => {
			const id = await entitled(10);
			const eventId = randomUUIDv7();

			expect(await use(id, 2, eventId)).toEqual({ answer: 'OK', remaining: 8 });
			expect(await use(id, 2, eventId)).toEqual({ answer: 'DUP', remaining: 8 });
			expect(await counted(id)).toBe(2);
			expect(await redis.xLen(USAGE_STREAM)).toBe(1);
		});

		it('is a DUP, and not refused, when the first try took the last of the allowance', async () => {
			// It once answered DENY: the retry of a use that had been counted and would be billed.
			const id = await entitled(5);
			const eventId = randomUUIDv7();

			expect(await use(id, 5, eventId)).toEqual({ answer: 'OK', remaining: 0 });
			expect(await use(id, 5, eventId)).toEqual({ answer: 'DUP', remaining: 0 });
			expect(await counted(id)).toBe(5);
		});

		it('says nothing is left for a DUP that has no limit to count down from', async () => {
			const id = await entitled(null);
			const eventId = randomUUIDv7();
			await use(id, 1, eventId);

			expect(await use(id, 1, eventId)).toEqual({ answer: 'DUP', remaining: null });
		});

		it('is still a DUP after the worker has taken the entry off the stream', async () => {
			const id = await entitled(10);
			const eventId = randomUUIDv7();
			await use(id, 1, eventId);
			await redis.del(USAGE_STREAM);

			expect(await use(id, 1, eventId)).toEqual({ answer: 'DUP', remaining: 9 });
			expect(await redis.xLen(USAGE_STREAM)).toBe(0);
			expect(await counted(id)).toBe(1);
		});

		it('remembers the id for about five minutes', async () => {
			const id = await entitled(10);
			const eventId = randomUUIDv7();
			await use(id, 1, eventId);

			const ttl = await redis.ttl(eventKey(id, eventId));
			expect(ttl).toBeGreaterThan(290);
			expect(ttl).toBeLessThanOrEqual(300);
		});

		it('is not remembered when the use was refused, so the same event may be allowed later', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(1, { api_calls: 2 }));
			await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: 2 });
			const eventId = randomUUIDv7();

			expect(await use(id, 1, eventId)).toMatchObject({ answer: 'DENY', reason: 'limit' });
			expect(await redis.exists(eventKey(id, eventId))).toBe(0);

			// A newer version raises the limit, as a renewal or an upgrade would.
			await setEntitlementsScript(redis, id, active(2, { api_calls: 3 }));
			expect(await use(id, 1, eventId)).toEqual({ answer: 'OK', remaining: 0 });
			expect(await use(id, 1, eventId)).toEqual({ answer: 'DUP', remaining: 0 });
		});

		it("is one person's: the same id from somebody else is counted, and not taken for a repeat", async () => {
			const first = await entitled(10);
			const second = await entitled(10);
			const eventId = randomUUIDv7();
			await use(first, 1, eventId);

			expect(await use(second, 1, eventId)).toEqual({ answer: 'OK', remaining: 9 });
			expect(await counted(second)).toBe(1);
		});

		it('is not told it was counted already, when somebody with no subscription repeats the id of another', async () => {
			// Answered DUP, the caller would go on to do work that nobody was ever charged for.
			const subscriber = await entitled(10);
			const stranger = subject();
			await setEntitlementsScript(redis, stranger, none(1));
			const eventId = randomUUIDv7();
			await use(subscriber, 1, eventId);

			expect(await use(stranger, 1, eventId)).toMatchObject({ answer: 'DENY', reason: 'inactive' });
		});
	});

	describe('how long a hash is kept', () => {
		const SECOND = 1000;
		/** As a hash is a week after it was last written: about to go. */
		const nearlyGone = (id: string) => redis.pExpire(subjectKey(id), 60 * SECOND);
		const kept = (id: string) => redis.pTTL(subjectKey(id));

		it('is a week from each use that is counted', async () => {
			const id = await entitled(10);
			await nearlyGone(id);

			await use(id);

			expect(await kept(id)).toBeGreaterThan(SUBJECT_TTL - 60 * SECOND);
		});

		it('is a week from each time the worker writes it, when what it writes is no newer', async () => {
			// The worker writes every subscriber's state each time it asks Polar about them. For
			// somebody whose subscription has not changed that is the same version again, and it
			// is all that keeps the hash of a subscriber who is not using anything.
			const id = await entitled(10, 4, 3);
			await nearlyGone(id);

			await setEntitlementsScript(redis, id, active(3));

			expect(await kept(id)).toBeGreaterThan(SUBJECT_TTL - 60 * SECOND);
			expect(await counted(id)).toBe(4);
		});

		it('is not made longer by a use that is refused', async () => {
			const id = await entitled(1, 1);
			await nearlyGone(id);

			expect(await use(id)).toMatchObject({ answer: 'DENY' });

			expect(await kept(id)).toBeLessThanOrEqual(60 * SECOND);
		});
	});

	describe('writing what somebody is entitled to', () => {
		it('changes nothing for a version that is older or the same', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(5, { api_calls: 10 }));

			await setEntitlementsScript(redis, id, active(5, { api_calls: 20 }));
			await setEntitlementsScript(redis, id, none(4));

			expect(await readSubject(redis, id)).toMatchObject({
				version: 5,
				status: 'active',
				limits: { api_calls: 10 }
			});
		});

		it('keeps the counts and replaces the limits for a newer version in the same period', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(1, { api_calls: 10, other: 7 }));
			await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: 4 });

			await setEntitlementsScript(redis, id, active(2, { api_calls: 50 }));

			expect(await readSubject(redis, id)).toMatchObject({
				version: 2,
				hydrated: true,
				consumed: { api_calls: 4 },
				// `other` was dropped from the limits, and loses its field: it is not left behind.
				limits: { api_calls: 50 }
			});
			expect(await redis.hExists(subjectKey(id), 'l:other')).toBeFalsy();
		});

		it('drops a meter that is no longer limited, which then has no limit', async () => {
			const id = await entitled(10);

			await setEntitlementsScript(redis, id, active(2, {}));

			expect(await redis.hExists(subjectKey(id), 'l:api_calls')).toBeFalsy();
			expect(await use(id, 500)).toEqual({ answer: 'OK', remaining: null });
		});

		it('clears the counts for a newer version in another period, so the next use is COLD', async () => {
			const id = await entitled(10, 4);

			await setEntitlementsScript(redis, id, active(2, { api_calls: 10 }, NEXT_PERIOD));

			expect(await readSubject(redis, id)).toMatchObject({ hydrated: false, consumed: {} });
			expect(await use(id)).toEqual({ answer: 'COLD', periodStart: NEXT_PERIOD.getTime() });
		});

		it('clears the counts for a newer version with no period at all', async () => {
			const id = await entitled(10, 4);

			await setEntitlementsScript(redis, id, none(2));

			expect(await readSubject(redis, id)).toMatchObject({
				status: 'none',
				periodStart: null,
				hydrated: false,
				consumed: {}
			});
		});

		it('gives the hash a lifetime of a week, so that nobody stays in memory for ever', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(1));

			const left = await redis.pTTL(subjectKey(id));
			expect(left).toBeGreaterThan(SUBJECT_TTL - 10_000);
			expect(left).toBeLessThanOrEqual(SUBJECT_TTL);
		});
	});

	describe('loading the counts', () => {
		it('does nothing when they are loaded already', async () => {
			// Two requests both find the hash cold. The second must not put its older sum over
			// what the first has since counted.
			const id = await entitled(10, 0);
			await use(id, 2);

			await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: 0 });

			expect(await counted(id)).toBe(2);
		});

		it('does nothing when the hash has moved on to another period', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(2, { api_calls: 10 }, NEXT_PERIOD));

			await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: 9 });

			expect(await readSubject(redis, id)).toMatchObject({ hydrated: false, consumed: {} });
		});

		it('marks the hash loaded even when the period has no use to count', async () => {
			const id = subject();
			await setEntitlementsScript(redis, id, active(1));

			await hydrateScript(redis, id, PERIOD.getTime(), {});

			expect(await readSubject(redis, id)).toMatchObject({ hydrated: true, consumed: {} });
		});
	});

	describe('when Redis has forgotten its scripts', () => {
		const forget = () => redis.sendCommand(['SCRIPT', 'FLUSH']);

		it('still allows a use', async () => {
			const id = await entitled(10);
			await forget();

			expect(await use(id)).toEqual({ answer: 'OK', remaining: 9 });
		});

		it('still writes entitlements and loads counts', async () => {
			const id = subject();
			await forget();
			await setEntitlementsScript(redis, id, active(1));
			await forget();
			await hydrateScript(redis, id, PERIOD.getTime(), { api_calls: 6 });

			expect(await readSubject(redis, id)).toMatchObject({
				hydrated: true,
				consumed: { api_calls: 6 }
			});
		});
	});

	describe('round trips', () => {
		// What is counted is the times the server read from this connection: `read-events` in
		// `CLIENT INFO`. A client that waits for each answer before sending the next causes one
		// read per round trip. `tot-cmds` is no use for this: Redis counts the commands a script
		// runs inside itself under the caller (an allowed use is six, an EVALSHA and its five), and
		// the server-wide counters are shared with other test files. Read twice, the difference
		// holds the second read itself, which is found out by measuring nothing at all.
		const reads = async () => {
			const info = String(await redis.sendCommand(['CLIENT', 'INFO']));
			return Number(/read-events=(\d+)/.exec(info)?.[1]);
		};
		const roundTripsFor = async (work: () => Promise<unknown>) => {
			const before = await reads();
			await work();
			const after = await reads();
			return after - before;
		};

		it('is one round trip for each use, once the scripts are known to the server', async () => {
			const id = await entitled(100);
			await use(id); // The script is loaded: from here on it is run by its hash.

			const measuring = await roundTripsFor(async () => {});
			expect(measuring).toBe(1);

			expect((await roundTripsFor(() => use(id))) - measuring).toBe(1);
		});

		it('counts two commands one after the other as two, so the measure can fail', async () => {
			const measuring = await roundTripsFor(async () => {});

			const two = await roundTripsFor(async () => {
				await redis.ping();
				await redis.ping();
			});

			expect(two - measuring).toBe(2);
		});

		it('is one round trip to read a person back', async () => {
			const id = await entitled(100);
			const measuring = await roundTripsFor(async () => {});

			expect((await roundTripsFor(() => readSubject(redis, id))) - measuring).toBe(1);
		});
	});

	describe('many at once', () => {
		it('lets exactly the limit through when 200 uses arrive together', async () => {
			const id = await entitled(50);

			const answers = await Promise.all(Array.from({ length: 200 }, () => use(id)));

			expect(answers.filter((each) => each.answer === 'OK')).toHaveLength(50);
			expect(answers.filter((each) => each.answer === 'DENY')).toHaveLength(150);
			expect(await counted(id)).toBe(50);
			expect(await redis.xLen(USAGE_STREAM)).toBe(50);
		});
	});
});
