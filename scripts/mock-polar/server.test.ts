// The mock stands in for Polar during development, and the app's billing is written against what
// it does, so what these pin is that it keeps Polar's promises where the app depends on them: the
// calls the SDK makes, the events Polar refuses, how usage is counted against credits, and how its
// webhooks are signed and retried. A mock that is too lenient lets the app ship a call Polar would
// refuse, and usage that is never billed. One that is too strict, or that counts differently,
// leaves the app showing a balance that Polar will not. Each test goes through a real socket, with
// the real SDK wherever the shape of a call is the point, because the SDK's addresses and the
// mock's agreeing is one of the things under test.

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolarClientError, PolarRateLimitError } from '@polar-sh/sdk';
import { createPolarCore, errors, webhooks } from '@polar-sh/sdk/2026-10';
import { createCheckouts } from '@polar-sh/sdk/2026-10/services/checkouts';
import { createCustomerSessions } from '@polar-sh/sdk/2026-10/services/customer_sessions';
import {
	deleteExternalCustomers,
	getStateExternalCustomers
} from '@polar-sh/sdk/2026-10/services/customers';
import { ingestEvents } from '@polar-sh/sdk/2026-10/services/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPolar, METER, PRODUCT, signWebhook, TOKEN, WEBHOOK_SECRET } from './server.js';

/** Where checkouts send the visitor back to. Not on this machine, so no webhook goes there. */
const SUCCESS = 'https://app.example/billing/done?checkout={CHECKOUT_ID}';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const HOUR = 3_600_000;

let clock = 0;

beforeEach(() => {
	clock = Date.now();
});

// Every server a test starts, closed after it, the last started first.
const running: Server[] = [];

afterEach(async () => {
	for (const server of running.splice(0).reverse()) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

async function listen(server: Server) {
	running.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

type Mock = Awaited<ReturnType<typeof start>>;

async function start(options: Parameters<typeof createMockPolar>[0] = {}) {
	const server = createMockPolar({ now: () => clock, retryDelays: [20, 20, 20], ...options });
	const base = await listen(server);
	return { server, base, polar: createPolarCore({ accessToken: TOKEN, baseUrl: base }) };
}

type Received = { path: string; headers: Record<string, string>; body: string };

/** The app's end of the webhooks: it records each, and answers with what `answer` says. */
async function receiver(answer: (count: number) => number = () => 204) {
	const received: Received[] = [];
	const server = createServer((request, response) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', (chunk) => {
			body += chunk;
		});
		request.on('end', () => {
			const headers = request.headers as Record<string, string>;
			received.push({ path: request.url ?? '', headers, body });
			const status = answer(received.length);
			const moved = status >= 300 && status < 400 ? { location: '/elsewhere' } : {};
			response.writeHead(status, moved).end();
		});
	});
	const base = await listen(server);
	return { base, url: `${base}/api/webhooks/polar`, received };
}

function openCheckout(mock: Mock, externalId: string, extra: Record<string, string> = {}) {
	return createCheckouts(mock.polar)({
		products: [PRODUCT.id],
		external_customer_id: externalId,
		success_url: SUCCESS,
		...extra
	});
}

/** What a browser does with a button on one of the mock's pages. */
function press(url: string) {
	return fetch(url, { method: 'POST', redirect: 'manual' });
}

async function subscribe(mock: Mock, externalId: string) {
	const checkout = await openCheckout(mock, externalId);
	const paid = await press(`${checkout.url}/pay`);
	expect(paid.status).toBe(303);
	return checkout;
}

function state(mock: Mock, externalId: string) {
	return getStateExternalCustomers(mock.polar)(externalId);
}

function ingest(mock: Mock, events: Parameters<ReturnType<typeof ingestEvents>>[0]['events']) {
	return ingestEvents(mock.polar)({ events });
}

/** A metered event for a customer, using this many units. */
function call(externalId: string, units = 1) {
	return { name: METER.eventName, external_customer_id: externalId, metadata: { units } };
}

function control(mock: Mock, externalId: string, action: string) {
	return fetch(`${mock.base}/mock/customers/${encodeURIComponent(externalId)}/${action}`, {
		method: 'POST',
		headers: AUTH
	});
}

function post(mock: Mock, path: string, body: unknown) {
	return fetch(`${mock.base}${path}`, {
		method: 'POST',
		headers: { ...AUTH, 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

type Delivery = {
	id: string;
	type: string;
	attempts: number;
	delivered: boolean;
	last_status: number | null;
	next_attempt_at: string | null;
};

async function deliveries(mock: Mock) {
	const response = await fetch(`${mock.base}/mock/deliveries`, { headers: AUTH });
	expect(response.status).toBe(200);
	return ((await response.json()) as { items: Delivery[] }).items;
}

/** The deliveries, once every one is delivered or given up on. */
function settled(mock: Mock) {
	return vi.waitFor(
		async () => {
			const items = await deliveries(mock);
			if (items.some((item) => item.next_attempt_at !== null)) throw new Error('Still sending.');
			return items;
		},
		{ timeout: 4000, interval: 10 }
	);
}

/** The error a promise is rejected with. */
async function refusal(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('It was not refused.');
}

const iso = (time: number) => new Date(time).toISOString();

describe('the access token', () => {
	it('is required on every API and control address, and nowhere else', async () => {
		const mock = await start();

		const bare = await fetch(`${mock.base}/v1/customers/external/someone/state`);
		expect(bare.status).toBe(401);
		expect(await bare.json()).toEqual({ error: 'Unauthorized', detail: expect.any(String) });

		const wrong = createPolarCore({ accessToken: 'not-the-token', baseUrl: mock.base });
		const error = await refusal(getStateExternalCustomers(wrong)('someone'));
		expect(error).toBeInstanceOf(PolarClientError);
		expect((error as PolarClientError).statusCode).toBe(401);

		expect((await fetch(`${mock.base}/mock/deliveries`)).status).toBe(401);
		expect((await fetch(`${mock.base}/healthz`)).status).toBe(200);
	});
});

describe('the SDK', () => {
	it('reaches every address the app uses, in the form it writes them', async () => {
		const mock = await start();
		const requested: string[] = [];
		mock.server.on('request', (request) => {
			if (request.url?.startsWith('/v1/')) requested.push(`${request.method} ${request.url}`);
		});
		const id = 'user 1/ü';

		await subscribe(mock, id);
		await ingest(mock, [call(id)]);
		await state(mock, id);
		await createCustomerSessions(mock.polar)({ external_customer_id: id });
		await deleteExternalCustomers(mock.polar)(id);

		const path = encodeURIComponent(id);
		expect(requested).toEqual([
			'POST /v1/checkouts/',
			'POST /v1/events/ingest',
			`GET /v1/customers/external/${path}/state`,
			'POST /v1/customer-sessions/',
			`DELETE /v1/customers/external/${path}`
		]);
	});
});

describe('a checkout', () => {
	it('is paid, and gives the customer the subscription, its period and its credits', async () => {
		// The 31st, so that the month ahead ends on the last day of February.
		clock = Date.UTC(2027, 0, 31, 12);
		const mock = await start();
		const id = randomUUID();
		const checkout = await openCheckout(mock, id, {
			customer_email: 'ada@example.com',
			customer_name: 'Ada',
			return_url: 'https://app.example/pricing'
		});

		expect(checkout).toMatchObject({
			created_at: iso(clock),
			modified_at: null,
			status: 'open',
			expires_at: iso(clock + HOUR),
			success_url: `https://app.example/billing/done?checkout=${checkout.id}`,
			return_url: 'https://app.example/pricing',
			embed_origin: null,
			product_id: PRODUCT.id,
			customer_id: null,
			customer_email: 'ada@example.com',
			customer_name: 'Ada',
			external_customer_id: id,
			is_payment_required: true,
			metadata: {}
		});
		expect(checkout.url).toBe(`${mock.base}/checkout/${checkout.client_secret}`);

		const shown = await fetch(checkout.url);
		expect(shown.status).toBe(200);
		const markup = await shown.text();
		for (const action of ['pay', 'fail', 'abandon']) {
			expect(markup).toContain(
				`<form method="post" action="/checkout/${checkout.client_secret}/${action}"`
			);
		}
		expect(markup).not.toContain('<script');

		const paid = await press(`${checkout.url}/pay`);
		expect(paid.status).toBe(303);
		expect(paid.headers.get('location')).toBe(checkout.success_url);

		const customer = await state(mock, id);
		expect(customer).toMatchObject({
			external_id: id,
			email: 'ada@example.com',
			name: 'Ada',
			type: 'individual',
			metadata: {},
			deleted_at: null
		});
		expect(customer.active_subscriptions).toEqual([
			expect.objectContaining({
				status: 'active',
				product_id: PRODUCT.id,
				recurring_interval: 'month',
				current_period_start: iso(clock),
				current_period_end: '2027-02-28T12:00:00.000Z',
				cancel_at_period_end: false,
				ends_at: null,
				meters: [
					expect.objectContaining({ meter_id: METER.id, consumed_units: 0, credited_units: 1000 })
				]
			})
		]);
		expect(customer.active_meters).toEqual([
			expect.objectContaining({
				meter_id: METER.id,
				consumed_units: 0,
				credited_units: PRODUCT.credits,
				balance: PRODUCT.credits
			})
		]);
		expect(customer.granted_benefits).toEqual([
			expect.objectContaining({
				benefit_type: 'meter_credit',
				properties: {
					last_credited_meter_id: METER.id,
					last_credited_units: PRODUCT.credits,
					last_credited_at: iso(clock)
				}
			})
		]);

		const again = await fetch(checkout.url);
		expect(again.status).toBe(410);
	});

	it('puts its id in for every {CHECKOUT_ID} in the success address', async () => {
		const mock = await start();
		const checkout = await openCheckout(mock, randomUUID(), {
			success_url: 'http://localhost:5173/{CHECKOUT_ID}/done?id={CHECKOUT_ID}'
		});
		expect(checkout.success_url).toBe(
			`http://localhost:5173/${checkout.id}/done?id=${checkout.id}`
		);
		const paid = await press(`${checkout.url}/pay`);
		expect(paid.headers.get('location')).toBe(checkout.success_url);
	});

	it('does not give a customer who has a subscription a second one', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);
		const first = (await state(mock, id)).active_subscriptions[0].id;

		const second = await openCheckout(mock, id);
		const paid = await press(`${second.url}/pay`);
		expect(paid.status).toBe(303);
		expect(paid.headers.get('location')).toBe(second.success_url);

		const subscriptions = (await state(mock, id)).active_subscriptions;
		expect(subscriptions.map((subscription) => subscription.id)).toEqual([first]);
	});

	it('fails, and then takes nothing more', async () => {
		const mock = await start();
		const id = randomUUID();
		const checkout = await openCheckout(mock, id, { return_url: 'https://app.example/pricing' });

		const failed = await press(`${checkout.url}/fail`);
		expect(failed.status).toBe(303);
		expect(failed.headers.get('location')).toBe('https://app.example/pricing');

		expect((await fetch(checkout.url)).status).toBe(410);
		expect((await press(`${checkout.url}/pay`)).status).toBe(410);
		expect(await refusal(state(mock, id))).toBeInstanceOf(errors.ResourceNotFound);
	});

	it('is left open when it is abandoned', async () => {
		const mock = await start();
		const checkout = await openCheckout(mock, randomUUID(), {
			return_url: 'https://app.example/pricing'
		});
		const left = await press(`${checkout.url}/abandon`);
		expect(left.status).toBe(303);
		expect(left.headers.get('location')).toBe('https://app.example/pricing');
		expect((await fetch(checkout.url)).status).toBe(200);
	});

	it('expires after an hour, and cannot be paid after', async () => {
		const mock = await start();
		const id = randomUUID();
		const checkout = await openCheckout(mock, id);

		clock += HOUR - 1;
		expect((await fetch(checkout.url)).status).toBe(200);
		clock += 1;
		expect((await fetch(checkout.url)).status).toBe(410);
		expect((await press(`${checkout.url}/pay`)).status).toBe(410);
		expect(await refusal(state(mock, id))).toBeInstanceOf(errors.ResourceNotFound);
	});

	it('is a 404 page for a secret it never issued', async () => {
		const mock = await start();
		const response = await fetch(`${mock.base}/checkout/made-up`);
		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toMatch(/^text\/html/);
	});

	it('escapes what it shows', async () => {
		const mock = await start();
		const checkout = await openCheckout(mock, randomUUID(), {
			customer_name: '<script>alert("hi")</script>'
		});
		const markup = await (await fetch(checkout.url)).text();
		expect(markup).not.toContain('<script');
		expect(markup).toContain('&#60;script&#62;alert(&#34;hi&#34;)&#60;/script&#62;');
	});

	it.each([
		['another product', { products: [randomUUID()] }, 'products'],
		['two products', { products: [PRODUCT.id, PRODUCT.id] }, 'products'],
		['no external customer id', { external_customer_id: undefined }, 'external_customer_id'],
		['no success address', { success_url: undefined }, 'success_url'],
		['a success address that is not http', { success_url: 'javascript:alert(1)' }, 'success_url'],
		['a return address that is not one', { return_url: 'not an address' }, 'return_url']
	])('is refused with %s', async (_, change, field) => {
		const mock = await start();
		const body = {
			products: [PRODUCT.id],
			external_customer_id: randomUUID(),
			success_url: SUCCESS,
			...change
		};
		const error = await refusal(createCheckouts(mock.polar)(body));
		expect(error).toBeInstanceOf(errors.HTTPValidationError);
		expect((error as errors.HTTPValidationError).error.detail).toEqual([
			{ loc: ['body', field], msg: expect.any(String), type: expect.any(String) }
		]);
	});
});

describe('ingesting events', () => {
	it('dedupes on external_id, within a request and across requests', async () => {
		const mock = await start();
		const id = randomUUID();
		const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];

		expect(
			await ingest(mock, [
				{ ...call(id), external_id: a },
				{ ...call(id), external_id: a },
				{ ...call(id), external_id: b },
				call(id),
				call(id)
			])
		).toEqual({ inserted: 4, duplicates: 1 });
		expect(
			await ingest(mock, [
				{ ...call(id), external_id: b },
				{ ...call(id), external_id: c }
			])
		).toEqual({ inserted: 1, duplicates: 1 });
	});

	it('takes what is at every limit', async () => {
		const mock = await start();
		const metadata: Record<string, unknown> = {
			_cost: { amount: 12, currency: 'usd' },
			_llm: { vendor: 'someone', model: 'something', input_tokens: 1 },
			['k'.repeat(40)]: 'v'.repeat(500),
			flag: false,
			ratio: 0.5
		};
		for (let index = Object.keys(metadata).length; index < 50; index++) metadata[`key${index}`] = 1;

		const response = await post(mock, '/v1/events/ingest', {
			events: [
				{ name: 'n'.repeat(128), external_customer_id: 'x', metadata },
				...Array.from({ length: 999 }, () => call('x'))
			]
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ inserted: 1000, duplicates: 0 });
	});

	const many = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`key${index}`, 1]));
	const long = 'k'.repeat(41);

	it.each([
		['an empty name', { name: '' }, ['name']],
		['a name of more than 128 characters', { name: 'n'.repeat(129) }, ['name']],
		['no name', { name: undefined }, ['name']],
		['no external customer id', { external_customer_id: undefined }, ['external_customer_id']],
		['an empty external customer id', { external_customer_id: '' }, ['external_customer_id']],
		[
			'a customer id in place of the external one',
			{ external_customer_id: undefined, customer_id: randomUUID() },
			['external_customer_id']
		],
		['a timestamp that is not one', { timestamp: 'yesterday' }, ['timestamp']],
		['an external id that is not a string', { external_id: 12 }, ['external_id']],
		['metadata that is not an object', { metadata: [1] }, ['metadata']],
		['more than 50 metadata keys', { metadata: many }, ['metadata']],
		['a metadata key of more than 40 characters', { metadata: { [long]: 1 } }, ['metadata', long]],
		[
			'a metadata string of more than 500 characters',
			{ metadata: { note: 'v'.repeat(501) } },
			['metadata', 'note']
		],
		['an empty metadata string', { metadata: { note: '' } }, ['metadata', 'note']],
		['a metadata object', { metadata: { note: { a: 1 } } }, ['metadata', 'note']],
		['a metadata list', { metadata: { note: [1] } }, ['metadata', 'note']],
		['a metadata null', { metadata: { note: null } }, ['metadata', 'note']],
		['a metadata number too big to be finite', '1e400', ['metadata', 'note']]
	])('refuses an event with %s, and keeps none of the request', async (_, change, loc) => {
		const mock = await start();
		const good = { ...call('x'), external_id: randomUUID() };
		// JSON cannot carry a number that is not finite, but it can carry one that parses to Infinity.
		const bad =
			typeof change === 'string'
				? `{"name":"api_call","external_customer_id":"x","metadata":{"note":${change}}}`
				: JSON.stringify({ ...call('x'), ...change });

		const response = await post(
			mock,
			'/v1/events/ingest',
			`{"events":[${JSON.stringify(good)},${bad}]}`
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			detail: [
				{ loc: ['body', 'events', 1, ...loc], msg: expect.any(String), type: expect.any(String) }
			]
		});

		expect(await ingest(mock, [good])).toEqual({ inserted: 1, duplicates: 0 });
	});

	it('refuses more than 1,000 events in a request', async () => {
		const mock = await start();
		const error = await refusal(
			ingest(
				mock,
				Array.from({ length: 1001 }, () => call('x'))
			)
		);
		expect(error).toBeInstanceOf(errors.HTTPValidationError);
		expect((error as errors.HTTPValidationError).error.detail).toEqual([
			{ loc: ['body', 'events'], msg: expect.any(String), type: 'too_long' }
		]);
	});

	it('refuses a body that is not JSON, or is too big to be a request', async () => {
		const mock = await start();
		const broken = await post(mock, '/v1/events/ingest', '{"events": [');
		expect(broken.status).toBe(422);

		const big = await post(mock, '/v1/checkouts/', { padding: 'x'.repeat(70_000) });
		expect(big.status).toBe(413);
	});

	it('sends no webhook', async () => {
		const app = await receiver();
		const mock = await start({ webhookUrl: app.url });
		await ingest(mock, [call('x', 5)]);
		expect(await deliveries(mock)).toEqual([]);
	});
});

describe('the meter', () => {
	const meter = async (mock: Mock, id: string) => (await state(mock, id)).active_meters[0];

	it('counts what was received this period, whatever time the event gives itself', async () => {
		const mock = await start();
		const id = randomUUID();
		// Before the subscription, and so before its first period.
		await ingest(mock, [call(id, 50)]);
		await subscribe(mock, id);

		await ingest(mock, [
			{ ...call(id, 5), timestamp: '2000-01-01T00:00:00Z' },
			{ name: 'something_else', external_customer_id: id, metadata: { units: 100 } },
			{ name: METER.eventName, external_customer_id: id, metadata: { units: 'many' } },
			{ name: METER.eventName, external_customer_id: id },
			call(randomUUID(), 7)
		]);

		expect(await meter(mock, id)).toMatchObject({ consumed_units: 5, balance: 995 });
		const subscription = (await state(mock, id)).active_subscriptions[0];
		expect(subscription.meters[0]).toMatchObject({ consumed_units: 5, credited_units: 1000 });
	});

	it('goes below zero, since Polar never stops usage', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);
		await ingest(mock, [call(id, 1200)]);
		expect(await meter(mock, id)).toMatchObject({ consumed_units: 1200, balance: -200 });
	});

	it('starts afresh when the period is cycled, and is credited again', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);
		await ingest(mock, [call(id, 7)]);

		// The period has not ended, so the next one starts now.
		clock += 1000;
		expect((await control(mock, id, 'cycle')).status).toBe(204);
		let customer = await state(mock, id);
		expect(customer.active_meters[0]).toMatchObject({ consumed_units: 0, balance: 1000 });
		const period = customer.active_subscriptions[0];
		expect(period.current_period_start).toBe(iso(clock));

		// Past its end, the next follows on from it. What was received between the end and the
		// cycle belonged to the period that ended.
		clock = Date.parse(period.current_period_end) + 5 * 86_400_000;
		await ingest(mock, [call(id, 3)]);
		expect((await control(mock, id, 'cycle')).status).toBe(204);
		customer = await state(mock, id);
		expect(customer.active_subscriptions[0].current_period_start).toBe(period.current_period_end);
		expect(customer.active_meters[0]).toMatchObject({ consumed_units: 0, credited_units: 1000 });
		expect(customer.granted_benefits[0].properties).toMatchObject({ last_credited_at: iso(clock) });

		// In the same millisecond as the cycle, and after it.
		await ingest(mock, [call(id, 2)]);
		expect(await meter(mock, id)).toMatchObject({ consumed_units: 2, balance: 998 });
	});
});

describe('a subscription', () => {
	it('past due is not active, and its meter is not either, until it recovers', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);
		const period = (await state(mock, id)).active_subscriptions[0];
		await ingest(mock, [call(id, 3)]);

		expect((await control(mock, id, 'past-due')).status).toBe(204);
		let customer = await state(mock, id);
		expect(customer.active_subscriptions).toEqual([]);
		expect(customer.active_meters).toEqual([]);
		expect(customer.granted_benefits).toHaveLength(1);

		expect(await ingest(mock, [call(id, 4)])).toEqual({ inserted: 1, duplicates: 0 });
		const cycling = await control(mock, id, 'cycle');
		expect(cycling.status).toBe(409);
		expect(await cycling.json()).toEqual({ error: 'Conflict', detail: expect.any(String) });

		expect((await control(mock, id, 'recover')).status).toBe(204);
		customer = await state(mock, id);
		expect(customer.active_subscriptions[0]).toMatchObject({
			id: period.id,
			current_period_start: period.current_period_start,
			current_period_end: period.current_period_end
		});
		expect(customer.active_meters[0]).toMatchObject({ consumed_units: 7, balance: 993 });
		expect((await control(mock, id, 'recover')).status).toBe(409);
	});

	it('ends at once when it is canceled, and can be taken out again', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);
		await ingest(mock, [call(id, 3)]);

		expect((await control(mock, id, 'cancel')).status).toBe(204);
		const customer = await state(mock, id);
		expect(customer.active_subscriptions).toEqual([]);
		expect(customer.active_meters).toEqual([]);
		expect(customer.granted_benefits).toEqual([]);
		expect((await control(mock, id, 'cancel')).status).toBe(409);
		expect((await control(mock, id, 'cycle')).status).toBe(409);

		await subscribe(mock, id);
		expect((await state(mock, id)).active_meters[0]).toMatchObject({ consumed_units: 0 });
	});

	it('cannot be changed for a customer the mock does not know, or in a way it does not offer', async () => {
		const mock = await start();
		expect((await control(mock, 'nobody', 'cancel')).status).toBe(404);
		const id = randomUUID();
		await subscribe(mock, id);
		expect((await control(mock, id, 'pause')).status).toBe(404);
	});
});

describe('deleting a customer', () => {
	it('removes them and their subscription, and their state is then not found', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);

		await deleteExternalCustomers(mock.polar)(id);
		const error = await refusal(state(mock, id));
		expect(error).toBeInstanceOf(errors.ResourceNotFound);
		expect((error as errors.ResourceNotFound).statusCode).toBe(404);
		expect(await refusal(deleteExternalCustomers(mock.polar)(id))).toBeInstanceOf(
			errors.ResourceNotFound
		);
	});
});

describe('the customer portal', () => {
	it('shows the meter, and does what its buttons say', async () => {
		const mock = await start();
		const id = randomUUID();
		await subscribe(mock, id);
		await ingest(mock, [call(id, 10)]);

		const session = await createCustomerSessions(mock.polar)({
			external_customer_id: id,
			return_url: 'https://app.example/account'
		});
		expect(session).toMatchObject({
			modified_at: null,
			expires_at: iso(clock + HOUR),
			return_url: 'https://app.example/account',
			customer: expect.objectContaining({ external_id: id })
		});
		expect(session.customer_portal_url).toBe(`${mock.base}/portal/${session.token}`);
		expect(session.customer_id).toBe(session.customer.id);

		const shown = await fetch(session.customer_portal_url);
		expect(shown.status).toBe(200);
		const markup = await shown.text();
		expect(markup).toContain('10 used of 1000, 990 left');
		expect(markup).toContain('href="https://app.example/account"');

		const cycled = await press(`${session.customer_portal_url}/cycle`);
		expect(cycled.status).toBe(303);
		expect(new URL(cycled.headers.get('location') as string, mock.base).href).toBe(
			session.customer_portal_url
		);
		expect((await state(mock, id)).active_meters[0]).toMatchObject({ consumed_units: 0 });

		expect((await press(`${session.customer_portal_url}/recover`)).status).toBe(409);

		clock += HOUR;
		expect((await fetch(session.customer_portal_url)).status).toBe(404);
	});

	// As a fault in the body, as Polar answers it: the SDK has no 404 for this address.
	it('is not opened for a customer the mock does not know', async () => {
		const mock = await start();
		const error = await refusal(
			createCustomerSessions(mock.polar)({ external_customer_id: 'nobody' })
		);
		expect(error).toBeInstanceOf(errors.HTTPValidationError);
		expect((error as errors.HTTPValidationError).error.detail).toEqual([
			{ loc: ['body', 'external_customer_id'], msg: expect.any(String), type: 'value_error' }
		]);
	});
});

describe('the rate limit', () => {
	it('refuses what is over it with a wait, until the minute has passed', async () => {
		const mock = await start({ requestsPerMinute: 3 });
		for (let count = 0; count < 3; count++) await ingest(mock, []);

		clock += 30_000;
		const error = await refusal(ingest(mock, []));
		expect(error).toBeInstanceOf(PolarRateLimitError);
		expect((error as PolarRateLimitError).retryAfter).toBe(30);

		clock += 30_000;
		expect(await ingest(mock, [])).toEqual({ inserted: 0, duplicates: 0 });
	});

	it('says to wait at least a second', async () => {
		const mock = await start({ requestsPerMinute: 1 });
		await ingest(mock, []);
		clock += 59_999;
		const error = await refusal(ingest(mock, []));
		expect((error as PolarRateLimitError).retryAfter).toBe(1);
	});
});

describe('webhooks', () => {
	it('are signed so that the SDK verifies them, and say what a payment did', async () => {
		const app = await receiver();
		const mock = await start({ webhookUrl: app.url });
		const id = randomUUID();
		const checkout = await subscribe(mock, id);

		const types = [
			'checkout.updated',
			'customer.created',
			'subscription.created',
			'subscription.active',
			'order.created',
			'order.paid',
			'benefit_grant.created',
			'customer.state_changed'
		];
		const items = await settled(mock);
		expect(items.map((item) => item.type)).toEqual(types);
		expect(items.every((item) => item.delivered && item.attempts === 1)).toBe(true);

		/** Each verified as the app will, and by type. */
		const payloads = new Map<string, Record<string, unknown> & { data: Record<string, unknown> }>();
		for (const { headers, body, path } of app.received) {
			expect(path).toBe('/api/webhooks/polar');
			expect(headers['webhook-api-version']).toBe('2026-10');
			const event = (await webhooks.validateEvent(body, headers, WEBHOOK_SECRET)) as {
				type: string;
			};
			payloads.set(event.type, JSON.parse(body));
		}
		expect([...payloads.keys()]).toEqual(types);

		const customer = await state(mock, id);
		expect(payloads.get('checkout.updated')?.data).toMatchObject({
			id: checkout.id,
			status: 'succeeded',
			customer_id: customer.id
		});
		expect(payloads.get('customer.created')?.data).toMatchObject({
			id: customer.id,
			external_id: id
		});
		for (const type of types.slice(2, 7)) {
			expect(payloads.get(type)?.data).toMatchObject({
				customer_id: customer.id,
				customer: expect.objectContaining({ external_id: id })
			});
		}
		expect(payloads.get('subscription.active')?.data).toMatchObject({
			id: customer.active_subscriptions[0].id,
			status: 'active',
			product_id: PRODUCT.id,
			current_period_start: customer.active_subscriptions[0].current_period_start,
			current_period_end: customer.active_subscriptions[0].current_period_end
		});
		expect(payloads.get('order.paid')?.data).toMatchObject({
			status: 'paid',
			billing_reason: 'subscription_create',
			product_id: PRODUCT.id,
			subscription_id: customer.active_subscriptions[0].id
		});
		expect(payloads.get('benefit_grant.created')?.data).toMatchObject({
			benefit_id: customer.granted_benefits[0].benefit_id,
			properties: customer.granted_benefits[0].properties
		});
		expect(payloads.get('customer.state_changed')).toMatchObject({
			api_version: '2026-10',
			timestamp: iso(clock),
			data: customer
		});

		const { headers, body } = app.received[0];
		const tampered = body.replace('succeeded', 'failed');
		expect(await refusal(webhooks.validateEvent(tampered, headers, WEBHOOK_SECRET))).toBeInstanceOf(
			webhooks.PolarWebhookVerificationError
		);
	});

	it('say what each change to a subscription did', async () => {
		const app = await receiver();
		const mock = await start({ webhookUrl: app.url });
		const id = randomUUID();
		await subscribe(mock, id);
		await settled(mock);

		/** The types sent after `action`, and the billing reason of any order among them. */
		const sentAfter = async (action: () => Promise<unknown>) => {
			const before = app.received.length;
			await action();
			await settled(mock);
			const sent = app.received.slice(before).map(({ body }) => JSON.parse(body));
			return {
				types: sent.map((payload) => payload.type),
				reasons: sent.flatMap((payload) => payload.data.billing_reason ?? [])
			};
		};

		expect(await sentAfter(() => control(mock, id, 'cycle'))).toEqual({
			types: [
				'order.created',
				'order.paid',
				'subscription.cycled',
				'benefit_grant.cycled',
				'customer.state_changed'
			],
			reasons: ['subscription_cycle', 'subscription_cycle']
		});
		expect((await sentAfter(() => control(mock, id, 'past-due'))).types).toEqual([
			'subscription.past_due',
			'customer.state_changed'
		]);
		expect((await sentAfter(() => control(mock, id, 'recover'))).types).toEqual([
			'subscription.active',
			'customer.state_changed'
		]);
		expect((await sentAfter(() => control(mock, id, 'cancel'))).types).toEqual([
			'subscription.canceled',
			'subscription.revoked',
			'benefit_grant.revoked',
			'customer.state_changed'
		]);
		expect((await sentAfter(() => deleteExternalCustomers(mock.polar)(id))).types).toEqual([
			'customer.deleted'
		]);
		const deleted = JSON.parse(app.received.at(-1)?.body ?? '');
		expect(deleted.data).toMatchObject({ external_id: id, deleted_at: iso(clock) });
	});

	it('are sent again, with the same id, after a failure', async () => {
		const app = await receiver((count) => (count === 1 ? 500 : 204));
		const mock = await start({ webhookUrl: app.url });
		const checkout = await openCheckout(mock, randomUUID());
		await press(`${checkout.url}/fail`);

		const items = await settled(mock);
		expect(items).toEqual([
			expect.objectContaining({
				type: 'checkout.updated',
				attempts: 2,
				delivered: true,
				last_status: 204
			})
		]);
		const [first, second] = app.received;
		expect(app.received).toHaveLength(2);
		expect(second.headers['webhook-id']).toBe(first.headers['webhook-id']);
		expect(second.body).toBe(first.body);
		await webhooks.validateEvent(second.body, second.headers, WEBHOOK_SECRET);
	});

	it('take a redirect for a failure, and are given up on after the last attempt', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const app = await receiver(() => 302);
			const mock = await start({ webhookUrl: app.url, retryDelays: [10] });
			const checkout = await openCheckout(mock, randomUUID());
			await press(`${checkout.url}/fail`);

			expect(await settled(mock)).toEqual([
				expect.objectContaining({
					attempts: 2,
					delivered: false,
					last_status: 302,
					next_attempt_at: null
				})
			]);
			expect(app.received.map(({ path }) => path)).toEqual([
				'/api/webhooks/polar',
				'/api/webhooks/polar'
			]);
			expect(warn).toHaveBeenCalledOnce();
		} finally {
			warn.mockRestore();
		}
	});

	it('do not wait behind one that is failing', async () => {
		const app = await receiver((count) => (count === 1 ? 500 : 204));
		const mock = await start({ webhookUrl: app.url, retryDelays: [300] });
		const first = await openCheckout(mock, randomUUID());
		const second = await openCheckout(mock, randomUUID());
		await press(`${first.url}/fail`);
		await press(`${second.url}/fail`);

		await settled(mock);
		const order = app.received.map(({ body }) => JSON.parse(body).data.id);
		expect(order).toEqual([first.id, second.id, first.id]);
	});

	it('go to the app a loopback success address belongs to, and nowhere else', async () => {
		const app = await receiver();
		const mock = await start();

		// Not on this machine: nothing is queued, as with a Polar that has no endpoint registered.
		const away = await openCheckout(mock, randomUUID());
		await press(`${away.url}/fail`);
		expect(await deliveries(mock)).toEqual([]);

		const home = await openCheckout(mock, randomUUID(), {
			success_url: `${app.base}/billing/done?checkout={CHECKOUT_ID}`
		});
		await press(`${home.url}/fail`);
		expect(await settled(mock)).toEqual([expect.objectContaining({ delivered: true })]);
		expect(app.received.map(({ path }) => path)).toEqual(['/api/webhooks/polar']);

		// And it stays there when a later checkout is sent back somewhere else.
		const later = await openCheckout(mock, randomUUID());
		await press(`${later.url}/fail`);
		await settled(mock);
		expect(app.received).toHaveLength(2);
	});

	it('are signed as Standard Webhooks signs them', () => {
		// The example in the Standard Webhooks specification.
		const headers = signWebhook(
			'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
			'msg_p5jXN8AQM9LWM0D4loKWxJek',
			1614265330,
			'{"test": 2432232314}'
		);
		expect(headers).toEqual({
			'content-type': 'application/json',
			'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
			'webhook-timestamp': '1614265330',
			'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
		});
		expect(Buffer.from(WEBHOOK_SECRET.slice('whsec_'.length), 'base64')).toHaveLength(32);
	});
});

describe('the state file', () => {
	let directory = '';

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), 'mock-polar-'));
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it('keeps customers and events across a restart', async () => {
		const file = join(directory, 'state.json');
		const id = randomUUID();
		const event = randomUUID();

		const first = await start({ stateFile: file });
		await subscribe(first, id);
		await ingest(first, [{ ...call(id, 5), external_id: event }]);
		first.server.closeAllConnections();
		await new Promise((resolve) => first.server.close(resolve));

		const second = await start({ stateFile: file });
		const customer = await state(second, id);
		expect(customer.active_subscriptions).toHaveLength(1);
		expect(customer.active_meters[0]).toMatchObject({ consumed_units: 5, balance: 995 });
		expect(await ingest(second, [{ ...call(id), external_id: event }])).toEqual({
			inserted: 0,
			duplicates: 1
		});
	});

	it('starts empty when there is none', async () => {
		const mock = await start({ stateFile: join(directory, 'not-yet.json') });
		expect(await refusal(state(mock, 'someone'))).toBeInstanceOf(errors.ResourceNotFound);
	});

	it('refuses to start from one it cannot read', () => {
		const file = join(directory, 'state.json');
		writeFileSync(file, '{"version": 1, "custo');
		expect(() => createMockPolar({ stateFile: file })).toThrow(/is not JSON/);

		writeFileSync(file, '[]');
		expect(() => createMockPolar({ stateFile: file })).toThrow(/not one this mock wrote/);

		expect(() => createMockPolar({ stateFile: directory })).toThrow(/could not be read/);
	});
});

describe('everything else', () => {
	it('is found with or without a trailing slash', async () => {
		const mock = await start();
		const created = await post(mock, '/v1/checkouts', {
			products: [PRODUCT.id],
			external_customer_id: randomUUID(),
			success_url: SUCCESS
		});
		expect(created.status).toBe(201);
		expect((await post(mock, '/v1/events/ingest/', { events: [] })).status).toBe(200);
	});

	it('is refused in Polar’s error shape', async () => {
		const mock = await start();
		for (const path of ['/v1/nowhere', '/v1/checkouts/extra', '/elsewhere']) {
			const response = await fetch(`${mock.base}${path}`, { headers: AUTH });
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({
				error: 'ResourceNotFound',
				detail: expect.any(String)
			});
		}

		const method = await fetch(`${mock.base}/v1/checkouts/`, { headers: AUTH });
		expect(method.status).toBe(405);
		expect(method.headers.get('allow')).toBe('POST');
	});

	it('answers a health check', async () => {
		const mock = await start();
		const response = await fetch(`${mock.base}/healthz`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});
