/**
 * Every table in the database, for Drizzle and for drizzle-kit, which writes the migrations in
 * drizzle/ from what is exported here (`pnpm db:generate`).
 *
 * The accounts' tables are generated from the auth configuration and are not edited by hand:
 * `pnpm auth:schema` writes ./auth-schema.ts again. The app's own tables go in files beside it,
 * exported from here.
 */
export * from './auth-schema.js';
export * from './billing-schema.js';
