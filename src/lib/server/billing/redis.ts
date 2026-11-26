/**
 * What billing keeps in Redis, and the three scripts that change it.
 *
 * Two keys do nearly all of it, and a third kind is short-lived (see `eventKey`):
 *
 * - `bl:sub:<subject>`, a hash for each person: what they are entitled to, and how much of each
 *   meter they have used this period. It is a copy. Everything in it can be put back from
 *   Postgres, so it may expire, and Redis may lose it.
 * - `bl:usage`, a stream: each use that was allowed, waiting for the worker to write it to the
 *   ledger. This is the one thing Redis holds that is nowhere else yet, for the quarter second
 *   or so until it is drained, which is why compose.yaml runs Redis with an append-only file.
 *
 * Entitlements and counters share a hash so that allowing a use is one round trip: one script
 * reads the status, the period and the limit, checks the count, records the event and adds to
 * the count, and nothing can come between any two of those. Kept apart, the period would have
 * to be read first and the script called second.
 *
 * Every key a script touches is passed to it as a key, never built inside it, which is what
 * Redis asks of a script that is to go on working on a cluster. There is no cluster yet, and so
 * no hash tags to put the two keys in one slot: when there is, that is a change to the two
 * names below.
 */
import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import { describeError } from '#lib/errors.js';
import { record } from '#lib/server/log.js';

/** The client as this file makes it. Its type is the one the options below give it. */
const connect = (url: string) => createClient({ url, disableOfflineQueue: true });

export type Redis = ReturnType<typeof connect>;

export const subjectKey = (subjectId: string) => `bl:sub:${subjectId}`;
export const USAGE_STREAM = 'bl:usage';

/**
 * How long a person's hash is kept after it was last written: a week. It is a backstop, so that
 * someone who never comes back does not stay in memory, and nothing depends on it.
 */
export const SUBJECT_TTL = 7 * 24 * 60 * 60 * 1000;

/**
 * Starts a connection to Redis, and answers with a function that hands it over once it is up.
 *
 * Nothing waits for Redis for long. The client keeps trying to connect for as long as it takes,
 * so its own promise of a connection is not one to wait on: measured with nothing listening, it
 * was still pending when the test gave up. So the function waits a second at most, and only for
 * a connection that is still being made for the first time, as it is in the moment after this
 * server starts. Once a try has failed, Redis is known to be away, and the function throws at
 * once until it is back. It waited the second every time at first. Measured then, with nothing
 * listening: every billing page took a second longer for as long as Redis was down, and each
 * wait left a listener on the client that was never taken off.
 *
 * A command sent while the connection is down fails at once as well, instead of queueing for it
 * to come back: a request that cannot count a use has to say so now, and a page that cannot
 * read an entitlement has Postgres to ask.
 *
 * The client says `error` on every failed try, several a second. One nobody listens for ends the
 * process, so it is listened for, and recorded once for each time the connection is lost.
 */
export function openRedis(url: string): {
	redis: () => Promise<Redis>;
	close: () => Promise<void>;
} {
	const client = connect(url);

	let down = false;
	client.on('error', (error) => {
		if (!down) record('error', 'redis connection lost', describeError(error));
		down = true;
	});
	client.on('ready', () => {
		if (down) record('info', 'redis connection back', {});
		down = false;
	});
	// Never rejects while the server is merely away, and a fault of any other kind is one the
	// listener above has been told of.
	client.connect().catch(() => {});

	let connecting: Promise<void> | undefined;

	return {
		async redis() {
			if (client.isReady) return client;
			if (!down) {
				// Until it is up, a try has failed, or a second has passed, whichever is first.
				// One wait, which every request that arrives during it shares.
				connecting ??= new Promise<void>((resolve) => {
					const settled = () => {
						clearTimeout(waited);
						client.off('ready', settled);
						client.off('error', settled);
						connecting = undefined;
						resolve();
					};
					const waited = setTimeout(settled, 1000);
					client.once('ready', settled);
					client.once('error', settled);
				});
				await connecting;
			}
			if (!client.isReady) throw new Error('Redis cannot be reached.');
			return client;
		},
		async close() {
			// `destroy` and not `close`: closing waits for a connection that may never come.
			client.destroy();
		}
	};
}

/** A script, with the hash Redis knows it by once it has been sent. */
interface Script {
	text: string;
	sha: string;
}

const script = (text: string): Script => ({
	text,
	sha: createHash('sha1').update(text).digest('hex')
});

/**
 * Runs a script by its hash, which is how a script is run without sending its text each time.
 * Redis forgets its scripts when it restarts, and says NOSCRIPT. The text is sent then, which
 * runs it and has it remembered again.
 */
async function run(redis: Redis, { text, sha }: Script, keys: string[], args: string[]) {
	try {
		return await redis.evalSha(sha, { keys, arguments: args });
	} catch (error) {
		if (!(error instanceof Error) || !error.message.startsWith('NOSCRIPT')) throw error;
		return redis.eval(text, { keys, arguments: args });
	}
}

/**
 * How long an event's id is remembered, in seconds: long enough for a caller that never heard
 * the answer to its first try to give up waiting and try again.
 */
const EVENT_MEMORY = 300;

/**
 * Where an event's id is remembered. It is one person's event: the same id from somebody else is
 * another event, and is not told that it has been counted already.
 */
export const eventKey = (subjectId: string, eventId: string) => `bl:evt:${subjectId}:${eventId}`;

/**
 * Allows one use, or says why not.
 *
 * KEYS: the person's hash, the usage stream, the event's own key.
 * ARGV: meter, units, the event's id, the person's id, how long to remember the id (seconds),
 * how long to keep the hash (ms).
 *
 * - `MISS`: the hash is not there. The caller puts it back from Postgres and asks again.
 * - `COLD`: it is there, but this period's counts are not. The caller adds them up from the
 *   ledger (see `hydrate`) and asks again. The period is handed back for that.
 * - `DUP`: this event has been recorded already, and is not counted again. A caller that is not
 *   sure its first try arrived can simply try again with the same id.
 * - `DENY`: there is no subscription, or the use would pass the limit. With what is left.
 * - `OK`: recorded and counted. With what is left, or -1 where there is no limit.
 *
 * Whether the event is a second try is asked before whether it fits, and the order matters. A
 * use that took the last of somebody's allowance does not fit a second time, and its retry was
 * at first told DENY: refused, for work that had been counted and would be billed. So an event's
 * id is kept in a key of its own for a few minutes, and looked for first.
 *
 * Redis can do this without the key: XADD with IDMP adds nothing for an id it has seen. It is
 * not used, for the reason above. It can only say an event is a repeat by being asked to add
 * it, which is after the decision to allow it. (Tried on Redis 8.10, it also remembers ids for
 * each producer apart: the same id from a second producer was added a second time.)
 *
 * An id that was refused is not remembered, so the same event may be tried again later, when
 * there is room for it.
 *
 * A use that is counted is a write to the hash, and keeps it for another week (`SUBJECT_TTL`).
 * It did not at first, and the hash of somebody using the product every day still ended a week
 * after their subscription last changed. Its counts were then added up again from the ledger,
 * without whatever was still waiting in the stream.
 */
const RECORD_USAGE = script(`
local sub = redis.call('HMGET', KEYS[1], 'v', 'st', 'ps', 'h', 'l:' .. ARGV[1], 'c:' .. ARGV[1])
if not sub[1] then return {'MISS'} end
local active = sub[2] == 'active'
if active and not sub[4] then return {'COLD', sub[3]} end

local limit = tonumber(sub[5] or '-1')
local consumed = tonumber(sub[6] or '0')
local units = tonumber(ARGV[2])

if redis.call('EXISTS', KEYS[3]) == 1 then
	if not active then return {'DUP', 0} end
	return {'DUP', limit >= 0 and math.max(limit - consumed, 0) or -1}
end
if not active then return {'DENY', 'inactive', 0} end
if limit >= 0 and consumed + units > limit then
	return {'DENY', 'limit', math.max(limit - consumed, 0)}
end

redis.call('XADD', KEYS[2], '*', 'id', ARGV[3], 's', ARGV[4], 'm', ARGV[1], 'u', ARGV[2], 'p', sub[3])
redis.call('SET', KEYS[3], '1', 'EX', ARGV[5])
consumed = redis.call('HINCRBY', KEYS[1], 'c:' .. ARGV[1], units)
redis.call('PEXPIRE', KEYS[1], ARGV[6])
return {'OK', limit >= 0 and limit - consumed or -1}
`);

export type RecordAnswer =
	| { answer: 'MISS' }
	| { answer: 'COLD'; periodStart: number }
	| { answer: 'DENY'; reason: 'inactive' | 'limit'; remaining: number }
	| { answer: 'DUP' | 'OK'; remaining: number | null };

export async function recordUsageScript(
	redis: Redis,
	use: { subjectId: string; meter: string; units: number; eventId: string }
): Promise<RecordAnswer> {
	const reply = (await run(
		redis,
		RECORD_USAGE,
		[subjectKey(use.subjectId), USAGE_STREAM, eventKey(use.subjectId, use.eventId)],
		[
			use.meter,
			String(use.units),
			use.eventId,
			use.subjectId,
			String(EVENT_MEMORY),
			String(SUBJECT_TTL)
		]
	)) as [string, ...(string | number)[]];

	const [answer, second, third] = reply;
	if (answer === 'MISS') return { answer };
	if (answer === 'COLD') return { answer, periodStart: Number(second) };
	if (answer === 'DENY') {
		return { answer, reason: second as 'inactive' | 'limit', remaining: Number(third) };
	}
	if (answer === 'DUP' || answer === 'OK') {
		return { answer, remaining: Number(second) < 0 ? null : Number(second) };
	}
	throw new Error(`The usage script answered "${answer}", which is none of its answers.`);
}

/**
 * Puts a period's counts into a person's hash, from the ledger.
 *
 * KEYS: the person's hash. ARGV: the period the counts are for, then meter and count in pairs.
 *
 * It does nothing unless the hash is still for that period and still has no counts: two requests
 * can both find it cold, and the second must not put an older sum over what the first has since
 * added to.
 */
const HYDRATE = script(`
local sub = redis.call('HMGET', KEYS[1], 'ps', 'h')
if sub[1] ~= ARGV[1] or sub[2] then return 0 end
for i = 2, #ARGV, 2 do
	redis.call('HSET', KEYS[1], 'c:' .. ARGV[i], ARGV[i + 1])
end
redis.call('HSET', KEYS[1], 'h', '1')
return 1
`);

export async function hydrateScript(
	redis: Redis,
	subjectId: string,
	periodStart: number,
	consumed: Record<string, number>
): Promise<void> {
	await run(
		redis,
		HYDRATE,
		[subjectKey(subjectId)],
		[
			String(periodStart),
			...Object.entries(consumed).flatMap(([meter, units]) => [meter, String(units)])
		]
	);
}

/**
 * Writes what a person is entitled to, unless the hash already holds that version or a later one.
 *
 * KEYS: the person's hash.
 * ARGV: version, how long to keep the hash (ms), status, product, period start, period end, then
 * meter and limit in pairs.
 *
 * Within a period the counts are left as they are, and only the entitlements change. For another
 * period, or none, the hash is emptied first: the counts were the old period's, and the new
 * period's are added up from the ledger the first time they are wanted. That is right whichever
 * way the period moved, where setting them to nought would only be right for a period that had
 * just begun.
 *
 * A version the hash already holds changes nothing in it, and still keeps it for another week:
 * the worker writes every subscriber's state here each time it asks Polar about them, changed
 * or not, and that is what keeps the hash of somebody who subscribes and uses nothing.
 */
const SET_ENTITLEMENTS = script(`
local current = redis.call('HMGET', KEYS[1], 'v', 'ps')
if current[1] and tonumber(current[1]) >= tonumber(ARGV[1]) then
	redis.call('PEXPIRE', KEYS[1], ARGV[2])
	return 0
end

if current[2] ~= ARGV[5] then
	redis.call('DEL', KEYS[1])
else
	for _, field in ipairs(redis.call('HKEYS', KEYS[1])) do
		if string.sub(field, 1, 2) == 'l:' then redis.call('HDEL', KEYS[1], field) end
	end
end

redis.call('HSET', KEYS[1], 'v', ARGV[1], 'st', ARGV[3], 'pr', ARGV[4], 'ps', ARGV[5], 'pe', ARGV[6])
for i = 7, #ARGV, 2 do
	redis.call('HSET', KEYS[1], 'l:' .. ARGV[i], ARGV[i + 1])
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`);

/** What a person is entitled to, as it is written to Redis. */
export interface StoredEntitlements {
	version: number;
	status: 'none' | 'active';
	productId: string | null;
	periodStart: Date | null;
	periodEnd: Date | null;
	/** The most of each meter that may be used in the period. A meter with no entry has no limit. */
	limits: Record<string, number>;
}

export async function setEntitlementsScript(
	redis: Redis,
	subjectId: string,
	stored: StoredEntitlements
): Promise<void> {
	await run(
		redis,
		SET_ENTITLEMENTS,
		[subjectKey(subjectId)],
		[
			String(stored.version),
			String(SUBJECT_TTL),
			stored.status,
			stored.productId ?? '',
			stored.periodStart ? String(stored.periodStart.getTime()) : '',
			stored.periodEnd ? String(stored.periodEnd.getTime()) : '',
			...Object.entries(stored.limits).flatMap(([meter, limit]) => [meter, String(limit)])
		]
	);
}

/** A person's hash, read back. Null if it is not there. */
export interface StoredSubject extends StoredEntitlements {
	/** Whether this period's counts have been loaded. Until they have, `consumed` is empty. */
	hydrated: boolean;
	consumed: Record<string, number>;
}

export async function readSubject(redis: Redis, subjectId: string): Promise<StoredSubject | null> {
	const hash = await redis.hGetAll(subjectKey(subjectId));
	if (hash.v === undefined) return null;

	const limits: Record<string, number> = {};
	const consumed: Record<string, number> = {};
	for (const [field, value] of Object.entries(hash)) {
		if (field.startsWith('l:')) limits[field.slice(2)] = Number(value);
		else if (field.startsWith('c:')) consumed[field.slice(2)] = Number(value);
	}

	return {
		version: Number(hash.v),
		status: hash.st === 'active' ? 'active' : 'none',
		productId: hash.pr || null,
		periodStart: hash.ps ? new Date(Number(hash.ps)) : null,
		periodEnd: hash.pe ? new Date(Number(hash.pe)) : null,
		limits,
		hydrated: hash.h !== undefined,
		consumed
	};
}
