/**
 * How Better Auth is told the visitor's address.
 *
 * It reads the address from a request header, and by default from `x-forwarded-for`, which is
 * the visitor's to write unless a proxy overwrites it. An address the visitor chooses is no
 * address at all for a rate limiter: every attempt would arrive from somewhere new.
 *
 * SvelteKit knows the real one. `event.getClientAddress()` is the socket's address, or the one
 * the deployment has told the Node adapter to trust (ADDRESS_HEADER). So it is passed on in a
 * header of this site's own, written here on every request Better Auth is given, over anything
 * that arrived under that name. Better Auth is set to read that header and no other (./index.ts).
 */
import type { RequestEvent } from '@sveltejs/kit';

export const CLIENT_ADDRESS_HEADER = 'x-client-address';

/** Writes the visitor's address into a request's headers, replacing whatever was there. */
export function setClientAddress(headers: Headers, event: Pick<RequestEvent, 'getClientAddress'>) {
	headers.delete(CLIENT_ADDRESS_HEADER);
	try {
		headers.set(CLIENT_ADDRESS_HEADER, event.getClientAddress());
	} catch {
		// Not every way of running the server knows the address. Better Auth then limits
		// everybody together for each path, and says so in the log once.
	}
}
