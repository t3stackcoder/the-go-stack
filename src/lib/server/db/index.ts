/**
 * The database: one pool of connections to Postgres, and Drizzle over it.
 *
 * Nothing connects when this is loaded. The pool opens a connection when the first query asks for
 * one, so loading it costs a request nothing, and building the site, which loads the server's
 * code to prerender pages, needs no database to be running.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describeError } from '#lib/errors.js';
import { record } from '#lib/server/log.js';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema.js';

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// A connection the pool is holding idle can fail: the database was restarted, or something
// between the two let the connection go. The pool reports that as an `error` event and replaces
// the connection, and an `error` event nobody listens for ends the process. So it is listened
// for, and recorded: a query that needed the database fails by itself, where it was asked.
pool.on('error', (error) => {
	record('error', 'database connection lost', describeError(error));
});

export const db = drizzle({ client: pool, schema });
