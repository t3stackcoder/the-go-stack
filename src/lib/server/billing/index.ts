/**
 * Billing, as the pages and endpoints use it. This is the only file of billing's that a route
 * imports.
 *
 * - `entitlements` says what somebody subscribes to and how much of each meter they have used.
 * - `recordUsage` counts a use against a meter, if it is allowed.
 * - `requestSync` has the worker ask Polar about somebody now, for the page a buyer waits on.
 * - `startCheckout` and `openPortal` send somebody to Polar, to pay or to manage what they pay
 *   for. They are the only two things here that talk to Polar, and each is somebody pressing a
 *   button and waiting to be sent there.
 * - `takeWebhook` is Polar telling this site that something changed.
 *
 * The first two are answered from Redis in one round trip (./service.ts), and a page that calls
 * neither costs nothing: nothing connects until something here is first called, so building the
 * site, which loads the server's code to prerender pages, needs no Redis to be running.
 *
 * Everything that takes time is somewhere else: the worker (./worker/main.ts, `pnpm
 * billing:worker`) writes usage to the ledger, sends it to Polar, and keeps each person's
 * entitlements the same as what Polar says.
 */
import { db } from '#lib/server/db/index.js';
import { REDIS_URL } from '$app/env/private';
import { catalogue, polarConnection, webhookSecret } from './config.js';
import { type CheckoutCalls, checkoutCalls } from './polar/checkout.js';
import { polarCore } from './polar/client.js';
import { openRedis } from './redis.js';
import { type Billing, createBilling } from './service.js';
import { type Receipt, receiveWebhook } from './webhook.js';

export { METERS, type MeterKey } from './catalogue.js';
export type { Entitlements, UsageResult } from './service.js';

let billing: Billing | undefined;
const service = () => (billing ??= createBilling({ redis: openRedis(REDIS_URL).redis, db }));

let calls: CheckoutCalls | undefined;
const polar = () => (calls ??= checkoutCalls(polarCore(polarConnection()), catalogue()));

export const entitlements: Billing['entitlements'] = (subjectId) =>
	service().entitlements(subjectId);

export const recordUsage: Billing['recordUsage'] = (use) => service().recordUsage(use);

export const requestSync: Billing['requestSync'] = (subjectId) => service().requestSync(subjectId);

/**
 * The address of Polar's checkout for the product, for somebody who pressed Upgrade.
 *
 * `origin` is this site's own address, as the request arrived at it. Polar sends the buyer back
 * to `/billing/activating` when they have paid, and to `/billing` if they give up.
 */
export function startCheckout(buyer: {
	subjectId: string;
	email: string;
	name: string | null;
	origin: string;
}): Promise<string> {
	return polar().createCheckout({
		subjectId: buyer.subjectId,
		email: buyer.email,
		name: buyer.name,
		successUrl: `${buyer.origin}/billing/activating`,
		returnUrl: `${buyer.origin}/billing`
	});
}

/** The address of Polar's own pages for a customer, or null for somebody who has never bought. */
export function openPortal(visit: { subjectId: string; origin: string }): Promise<string | null> {
	return polar().createPortal({ subjectId: visit.subjectId, returnUrl: `${visit.origin}/billing` });
}

/** Takes a webhook from Polar (./webhook.ts). `body` is the request's body exactly as it arrived. */
export function takeWebhook(body: string, headers: Headers): Promise<Receipt> {
	return receiveWebhook({ db, secret: webhookSecret() }, body, headers);
}
