// One customer's whole life, through every part at once: the real SDK, the fake Polar over a
// real socket, signed webhooks, Redis, Postgres, and each of the worker's jobs. The suites beside
// this one pin each part alone. This is the one that would notice if the parts had stopped
// agreeing with each other: a field Polar names one way and the worker reads another, a webhook
// the fake signs and the site refuses, a period that turns in Polar and not here.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockPolar, PRODUCT } from '../../../../scripts/mock-polar/server.js';
import { user } from '../db/auth-schema.js';
import { billingState, usageEvent } from '../db/billing-schema.js';
import { MOCK } from './catalogue.js';
import { addUser, reachServices } from './testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { createBilling } = await import('./service.js');
const { receiveWebhook } = await import('./webhook.js');
const { polarCore } = await import('./polar/client.js');
const { checkoutCalls } = await import('./polar/checkout.js');
const { syncCalls } = await import('./polar/sync.js');
const { drainOnce } = await import('./worker/drain.js');
const { shipOnce } = await import('./worker/ship.js');
const { removeDeleted, syncOnce } = await import('./worker/sync.js');

const services = await reachServices(7);

const catalogue = { productId: MOCK.productId, meterIds: { ...MOCK.meterIds } };
/** The catalogue allows this far past the period's credits (./catalogue.ts). */
const OVERAGE = 100;
const budget = { take: async () => {}, pause() {} };

const listening = (server: Server) =>
	new Promise<string>((resolve) =>
		server.listen(0, '127.0.0.1', () =>
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		)
	);

describe.skipIf(!services)('a customer, from checkout to deletion', () => {
	const { redis, db } = services!;
	const billing = createBilling({ redis: async () => redis, db });

	/** What the site answered each webhook with, in the order they arrived. */
	const answered: number[] = [];
	// The site's own webhook address, reduced to what it does: hand the bytes to `receiveWebhook`.
	const site = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const receipt = await receiveWebhook(
			{ db, secret: MOCK.webhookSecret },
			Buffer.concat(chunks).toString('utf8'),
			new Headers(request.headers as Record<string, string>)
		);
		answered.push(receipt.status);
		response.writeHead(receipt.status).end();
	});

	let mock: Server;
	let polar = '';
	let checkout: ReturnType<typeof checkoutCalls>;
	let sync: ReturnType<typeof syncCalls>;

	beforeAll(async () => {
		const address = await listening(site);
		mock = createMockPolar({ webhookUrl: `${address}/api/webhooks/polar` });
		polar = await listening(mock);

		const core = polarCore({ accessToken: MOCK.accessToken, baseUrl: polar });
		checkout = checkoutCalls(core, catalogue);
		sync = syncCalls(core, catalogue);
	});

	afterAll(async () => {
		for (const server of [mock, site]) {
			server?.closeAllConnections();
			await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
		}
		await services?.close();
	});

	/** Does to the fake what its portal page's buttons do. */
	const press = (button: 'cycle' | 'past-due' | 'recover' | 'cancel') =>
		fetch(`${polar}/mock/customers/buyer/${button}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${MOCK.accessToken}` }
		}).then((response) => expect(response.status).toBe(204));

	/** Waits until the fake has no webhook left to send, as a real Polar would get to in its own time. */
	async function delivered() {
		for (let tries = 0; tries < 200; tries++) {
			const response = await fetch(`${polar}/mock/deliveries`, {
				headers: { authorization: `Bearer ${MOCK.accessToken}` }
			});
			const { items } = (await response.json()) as {
				items: { delivered: boolean; next_attempt_at: string | null }[];
			};
			if (items.every((item) => item.next_attempt_at === null)) {
				expect(items.every((item) => item.delivered)).toBe(true);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error('The fake Polar still had webhooks to send after two seconds.');
	}

	/** The worker's part after a change in Polar: hear of it, and ask what is true now. */
	async function caughtUp() {
		await delivered();
		while ((await syncOnce({ db, redis, polar: sync, budget })) > 0);
	}

	const use = (units: number) =>
		billing.recordUsage({ subjectId: 'buyer', meter: 'api_calls', units });

	it('is nobody to billing until they have paid, and cannot use the meter', async () => {
		await addUser(db, 'buyer');

		expect((await billing.entitlements('buyer')).status).toBe('none');
		expect(await use(1)).toEqual({ allowed: false, reason: 'inactive', remaining: 0 });
		// Polar has no customer for them yet, so there is nothing of theirs to manage there.
		expect(
			await checkout.createPortal({ subjectId: 'buyer', returnUrl: 'http://localhost/billing' })
		).toBeNull();
	});

	it('is subscribed once Polar says so, which is after the webhook and not on the way back from paying', async () => {
		const url = await checkout.createCheckout({
			subjectId: 'buyer',
			email: 'buyer@example.com',
			name: 'A Buyer',
			successUrl: 'http://localhost:5173/billing/activating',
			returnUrl: 'http://localhost:5173/billing'
		});
		expect(url.startsWith(`${polar}/checkout/`)).toBe(true);

		const paid = await fetch(`${url}/pay`, { method: 'POST', redirect: 'manual' });
		expect(paid.status).toBe(303);
		expect(paid.headers.get('location')).toBe('http://localhost:5173/billing/activating');

		// Sent back already, and still nobody: nothing here took the buyer's word for it.
		expect((await billing.entitlements('buyer')).status).toBe('none');

		await caughtUp();
		expect(answered.length).toBeGreaterThan(0);
		expect(answered.every((status) => status === 202)).toBe(true);

		const entitled = await billing.entitlements('buyer');
		expect(entitled.status).toBe('active');
		expect(entitled.productId).toBe(PRODUCT.id);
		expect(entitled.meters.api_calls).toEqual({ consumed: 0, limit: PRODUCT.credits + OVERAGE });
		expect(entitled.periodEnd!.getTime()).toBeGreaterThan(Date.now());

		expect(
			await checkout.createPortal({ subjectId: 'buyer', returnUrl: 'http://localhost/billing' })
		).toMatch(new RegExp(`^${polar}/portal/`));
	});

	it('has its use counted here at once, and by Polar once the worker has sent it', async () => {
		expect(await use(300)).toEqual({ allowed: true, duplicate: false, remaining: 800 });
		expect(await use(50)).toEqual({ allowed: true, duplicate: false, remaining: 750 });

		// Polar has heard nothing yet. It is this site that knows, and this site that limits.
		expect((await sync.customerState('buyer'))?.meters.api_calls?.consumed).toBe(0);

		while ((await drainOnce({ redis, db })) > 0);
		// The first pass makes the stream's group and reads nothing, so it is asked once more.
		while ((await drainOnce({ redis, db })) > 0);
		expect(await db.$count(usageEvent, eq(usageEvent.subjectId, 'buyer'))).toBe(2);

		expect(await shipOnce({ db, polar: sync, budget })).toBe(2);
		expect(await shipOnce({ db, polar: sync, budget })).toBe(0);
		expect((await sync.customerState('buyer'))?.meters.api_calls).toEqual({
			credited: PRODUCT.credits,
			consumed: 350
		});
	});

	it('is stopped at the credits and the overage, and not a unit before', async () => {
		expect(await use(750)).toEqual({ allowed: true, duplicate: false, remaining: 0 });
		expect(await use(1)).toEqual({ allowed: false, reason: 'limit', remaining: 0 });
		expect((await billing.entitlements('buyer')).meters.api_calls.consumed).toBe(1100);
	});

	it('starts from nought when Polar turns the period', async () => {
		const before = (await billing.entitlements('buyer')).periodStart!;
		while ((await drainOnce({ redis, db })) > 0);
		while ((await shipOnce({ db, polar: sync, budget })) > 0);

		await press('cycle');
		await caughtUp();

		const entitled = await billing.entitlements('buyer');
		expect(entitled.periodStart!.getTime()).toBeGreaterThan(before.getTime());
		expect(entitled.meters.api_calls).toEqual({ consumed: 0, limit: PRODUCT.credits + OVERAGE });
		expect(await use(10)).toEqual({ allowed: true, duplicate: false, remaining: 1090 });
	});

	it('is shut out while a payment has failed, and let back in where they left off', async () => {
		await press('past-due');
		await caughtUp();
		expect((await billing.entitlements('buyer')).status).toBe('none');
		expect(await use(1)).toEqual({ allowed: false, reason: 'inactive', remaining: 0 });

		// The ten units allowed before the failure are in the ledger by the time they are wanted.
		while ((await drainOnce({ redis, db })) > 0);

		await press('recover');
		await caughtUp();
		// The same period as before, so its count comes back from the ledger and is not lost.
		expect((await billing.entitlements('buyer')).meters.api_calls.consumed).toBe(10);
		expect(await use(1)).toEqual({ allowed: true, duplicate: false, remaining: 1089 });
	});

	it('is nobody again once they cancel', async () => {
		await press('cancel');
		await caughtUp();
		expect((await billing.entitlements('buyer')).status).toBe('none');
		expect(await use(1)).toEqual({ allowed: false, reason: 'inactive', remaining: 0 });
	});

	it('is removed from Polar when their account is deleted, and the ledger is kept', async () => {
		await db.delete(user).where(eq(user.id, 'buyer'));

		// Not while Polar has yet to be sent some of their use: it would then be sent events
		// for a customer it no longer has.
		while ((await drainOnce({ redis, db })) > 0);
		expect(await removeDeleted({ db, redis, polar: sync, budget })).toBe(0);
		while ((await shipOnce({ db, polar: sync, budget })) > 0);

		expect(await removeDeleted({ db, redis, polar: sync, budget })).toBe(1);

		expect(await sync.customerState('buyer')).toBeNull();
		expect(await db.$count(billingState, eq(billingState.subjectId, 'buyer'))).toBe(0);
		expect(await db.$count(usageEvent, eq(usageEvent.subjectId, 'buyer'))).toBeGreaterThan(0);

		// Polar's webhook about the deletion names somebody with no account. No row is made for
		// them, or the next pass would take it for another deleted account and ask again.
		await delivered();
		expect(await db.$count(billingState, eq(billingState.subjectId, 'buyer'))).toBe(0);
	});

	it('is subscribed though no webhook ever arrived, once they are back from paying', async () => {
		// A Polar whose webhooks reach nobody: this site was down for every try, or Polar had
		// stopped sending to it. The buyer has paid all the same.
		const nowhere = createServer();
		const dead = await listening(nowhere);
		await new Promise((resolve) => nowhere.close(resolve));
		const deaf = createMockPolar({ webhookUrl: `${dead}/api/webhooks/polar`, retryDelays: [] });
		try {
			const core = polarCore({ accessToken: MOCK.accessToken, baseUrl: await listening(deaf) });
			const asked = syncCalls(core, catalogue);
			await addUser(db, 'unheard');

			const url = await checkoutCalls(core, catalogue).createCheckout({
				subjectId: 'unheard',
				email: 'unheard@example.com',
				name: null,
				successUrl: 'http://localhost:5173/billing/activating',
				returnUrl: 'http://localhost:5173/billing'
			});
			expect((await fetch(`${url}/pay`, { method: 'POST', redirect: 'manual' })).status).toBe(303);

			// Nothing here has heard of them, so the worker has nobody to ask Polar about. This is
			// where they stayed: paid, and refused.
			expect(await syncOnce({ db, redis, polar: asked, budget })).toBe(0);
			expect((await billing.entitlements('unheard')).status).toBe('none');

			// What the page they are sent back to does (src/routes/billing/activating).
			await billing.requestSync('unheard');
			while ((await syncOnce({ db, redis, polar: asked, budget })) > 0);

			expect((await billing.entitlements('unheard')).status).toBe('active');
			expect(await billing.recordUsage({ subjectId: 'unheard', meter: 'api_calls' })).toMatchObject(
				{ allowed: true }
			);
		} finally {
			deaf.closeAllConnections();
			await new Promise((resolve) => deaf.close(resolve));
		}
	});
});
