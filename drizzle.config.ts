import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside the app, so it reads the address from the environment and not from
// `$app/env/private`. The scripts in package.json load .env for it.
//
// `pnpm db:generate` compares the schema with the migrations already written and needs no
// database, so the address may be missing then. `pnpm db:migrate` says so itself if it is.
export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dbCredentials: { url: process.env.DATABASE_URL ?? '' }
});
