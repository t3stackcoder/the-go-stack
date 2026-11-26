/**
 * The connection to Polar that every call in this directory is made through.
 *
 * It is Polar's own SDK, pinned to one version of Polar's API by the path it is imported from:
 * moving to the next version is a change to `2026-10` here and in the two files beside this one.
 * Each call is imported by itself and handed this client, which is how the SDK is written to be
 * used when only a few of its calls are wanted.
 *
 * The calls are in two files, by who may make them. ./checkout.ts is the two a request may make:
 * a person asked to be sent to Polar, and is waiting to be. ./sync.ts is everything else, and is
 * the worker's. Nothing that serves a request may import it, and
 * src/lib/server/billing/boundary.test.ts fails if anything does: a page that waits on Polar is
 * as slow as Polar is, and down when it is.
 */
import { PolarClientError } from '@polar-sh/sdk';
import { createPolarCore, type PolarCore } from '@polar-sh/sdk/2026-10';

export type { PolarCore };

export interface PolarConnection {
	accessToken: string;
	/** The fake's address. Left out, it is the real Polar that `server` names. */
	baseUrl?: string;
	server?: 'sandbox' | 'production';
}

export function polarCore({
	accessToken,
	baseUrl,
	server = 'sandbox'
}: PolarConnection): PolarCore {
	return createPolarCore(
		baseUrl === undefined ? { accessToken, environment: server } : { accessToken, baseUrl }
	);
}

/** Whether Polar answered that it has no such thing: a customer it has never heard of, mostly. */
export const isNotFound = (error: unknown): boolean =>
	error instanceof PolarClientError && error.statusCode === 404;

/** Whether Polar refused what it was sent as invalid. Sending the same thing again will not help. */
export const isInvalid = (error: unknown): boolean =>
	error instanceof PolarClientError && error.statusCode === 422;
