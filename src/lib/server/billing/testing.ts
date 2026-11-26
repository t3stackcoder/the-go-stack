/**
 * What billing's tests stand on: a real Redis and a real Postgres, each test file with its own
 * corner of both.
 *
 * Neither is faked, because what is being tested is what they do: a Lua script's atomicity, a
 * stream that hands an entry out twice, an insert that conflicts with itself. They are the ones
 * compose.yaml runs (`docker compose up -d --wait`), found at the addresses .env.example gives
 * them unless REDIS_URL or DATABASE_URL says otherwise.
 *
 * - Redis: each file is given a numbered database to itself, emptied before it starts, because
 *   billing's keys have fixed names and two files run at once would read each other's.
 * - Postgres: each file makes a database of its own, with a random name, applies every migration
 *   in drizzle/ to it, and drops it when it is done. The developer's own database is never touched.
 *
 * Without the services, on a developer's machine, the tests are skipped and say so: the rest of
 * `pnpm test` needs no Docker, and should not start to. In CI they must run, so there a missing
 * service is a failure and not a skip.
 */
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createClient } from 'redis';
import * as schema from '../db/schema.js';
import type { Redis } from './redis.js';
import type { Database } from './service.js';

const REDIS = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const POSTGRES =
	process.env.DATABASE_URL ?? 'postgres://team:team@127.0.0.1:5432/team_collaborator';

export interface Services {
	redis: Redis;
	db: Database;
	/** The pool under `db`, for a statement Drizzle has no words for. */
	pool: pg.Pool;
	/** Closes both and drops the database. Call it from `afterAll`. */
	close(): Promise<void>;
}

/**
 * Connects to both services, or answers null where they are not running and need not be.
 *
 * @param redisDatabase Which of Redis's numbered databases this file has to itself. Every test
 *   file that calls this passes a different one, from 1 to 15. 0 is the developer's.
 */
export async function reachServices(redisDatabase: number): Promise<Services | null> {
	try {
		return await connect(redisDatabase);
	} catch (error) {
		if (process.env.CI) throw error;
		console.warn(
			`Skipped: billing's tests need Redis and Postgres (docker compose up -d --wait). ${
				error instanceof Error ? error.message : error
			}`
		);
		return null;
	}
}

async function connect(redisDatabase: number): Promise<Services> {
	const redis = createClient({
		url: REDIS,
		database: redisDatabase,
		disableOfflineQueue: true,
		// One try, so that a Redis that is not there is found out at once and not waited for.
		socket: { reconnectStrategy: false, connectTimeout: 2000 }
	}) as Redis;
	redis.on('error', () => {});
	await redis.connect();
	await redis.flushDb();

	const name = `billing_test_${randomBytes(6).toString('hex')}`;
	const admin = new pg.Client({ connectionString: POSTGRES, connectionTimeoutMillis: 2000 });
	try {
		await admin.connect();
		await admin.query(`create database ${name}`);
	} catch (error) {
		redis.destroy();
		throw error;
	} finally {
		await admin.end().catch(() => {});
	}

	const address = new URL(POSTGRES);
	address.pathname = `/${name}`;
	const pool = new pg.Pool({ connectionString: address.href });
	const db = drizzle({ client: pool, schema });
	await migrate(db, { migrationsFolder: 'drizzle' });

	return {
		redis,
		db,
		pool,
		async close() {
			redis.destroy();
			await pool.end();
			const dropper = new pg.Client({ connectionString: POSTGRES });
			await dropper.connect();
			// FORCE, in case a test left a connection open: the database is going either way.
			await dropper.query(`drop database if exists ${name} with (force)`);
			await dropper.end();
		}
	};
}

/** Adds an account, which is all of one that billing looks at: that there is a row with this id. */
export async function addUser(db: Database, id: string): Promise<void> {
	await db.insert(schema.user).values({
		id,
		name: 'Test Person',
		email: `${id}@example.com`,
		emailVerified: true
	});
}
