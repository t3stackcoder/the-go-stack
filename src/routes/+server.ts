import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { RequestHandler } from './$types';

// The project's home lives at /team-collaborator for now. Temporary (307), not permanent, so that
// browsers do not remember it: the address at the root is expected to change.
export const GET: RequestHandler = () => redirect(307, resolve('/team-collaborator'));
