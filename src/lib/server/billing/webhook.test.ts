// The webhook is how a payment made at Polar reaches this site, and it is a public address that
// anybody can post to. Broken one way, somebody who has paid keeps being told they have not;
// broken the other, anyone who can guess the address marks accounts as changed, or fills the
// table with customers this site has never had. Requests are signed here as Polar signs them
// (Standard Webhooks), and the database is a real one.

import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingState } from '../db/billing-schema.js';
import { MOCK } from './catalogue.js';
import { addUser, reachServices } from './testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { receiveWebhook } = await import('./webhook.js');

const services = await reachServices(8);
afterAll(async () => services?.close());

let counter = 0;
const subject = () => `subject-${++counter}`;

/** A webhook's headers, signed as Polar signs them: HMAC-SHA256 over `id.timestamp.body`. */
function signed(
	body: string,
	{
		secret = MOCK.webhookSecret,
		id = `msg_${++counter}`,
		timestamp = Math.floor(Date.now() / 1000)
	}: { secret?: string; id?: string; timestamp?: number } = {}
) {
	const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
	const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
	return new Headers({
		'webhook-id': id,
		'webhook-timestamp': String(timestamp),
		'webhook-signature': `v1,${signature}`
	});
}

const payload = (type: string, data: unknown) =>
	JSON.stringify({ type, timestamp: new Date().toISOString(), api_version: '2026-10', data });

describe.skipIf(!services)('a webhook from Polar', () => {
	const { db } = services!;
	const take = (body: string, headers: Headers) =>
		receiveWebhook({ db, secret: MOCK.webhookSecret }, body, headers);

	const rows = () => db.select().from(billingState);
	const rowOf = async (subjectId: string) =>
		(await rows()).find((each) => each.subjectId === subjectId);

	beforeEach(async () => {
		await db.delete(billingState);
	});

	describe('about somebody with an account here', () => {
		it('marks their row as needing to be asked about, making it, and answers 202 with who', async () => {
			const id = subject();
			await addUser(db, id);
			const body = payload('customer.state_changed', { id: 'cus_1', external_id: id });

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: id });

			expect(await rowOf(id)).toMatchObject({ version: 0, status: 'none', syncedAt: null });
			expect((await rowOf(id))?.dirtyAt).toBeInstanceOf(Date);
		});

		it('marks a row that is there, and changes nothing else in it', async () => {
			const id = subject();
			await addUser(db, id);
			const syncedAt = new Date('2026-11-20T10:00:00Z');
			await db.insert(billingState).values({
				subjectId: id,
				version: 7,
				status: 'active',
				productId: 'product',
				credits: { api_calls: 1000 },
				syncedAt
			});
			const body = payload('customer.state_changed', { external_id: id });

			await take(body, signed(body));

			expect(await rowOf(id)).toMatchObject({
				version: 7,
				status: 'active',
				productId: 'product',
				credits: { api_calls: 1000 },
				syncedAt
			});
			expect((await rowOf(id))?.dirtyAt).toBeInstanceOf(Date);
		});

		it('is harmless when the same webhook is delivered twice', async () => {
			const id = subject();
			await addUser(db, id);
			const body = payload('customer.state_changed', { external_id: id });
			const headers = signed(body);

			const first = await take(body, headers);
			const second = await take(body, headers);

			expect(first).toEqual({ status: 202, subjectId: id });
			expect(second).toEqual(first);
			expect(await rows()).toHaveLength(1);
		});

		it("finds a subscription event's person inside it, under customer", async () => {
			const id = subject();
			await addUser(db, id);
			const body = payload('subscription.active', {
				id: 'sub_1',
				customer: { id: 'cus_1', external_id: id }
			});

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: id });
			expect((await rowOf(id))?.dirtyAt).toBeInstanceOf(Date);
		});
	});

	describe('that is accepted and changes nothing', () => {
		it('about an id that is not an account here, is answered 202 and makes no row', async () => {
			const body = payload('customer.state_changed', { external_id: 'nobody-here' });

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: null });

			expect(await rows()).toHaveLength(0);
		});

		it('about a subscription of a customer that is not an account here, makes no row', async () => {
			const body = payload('subscription.active', { customer: { external_id: 'nobody-here' } });

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: null });

			expect(await rows()).toHaveLength(0);
		});

		it('about no customer, such as a product being edited, is answered 202', async () => {
			const body = payload('product.updated', { id: 'prod_1', name: 'Pro' });

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: null });

			expect(await rows()).toHaveLength(0);
		});

		// The SDK checks who signed a webhook and that its type has a name, and not what is in it.
		// So this reaches the code that looks for a customer, which once read a field of nothing
		// and answered 500, for Polar to send the same thing again.
		it('with nothing in it at all is answered 202', async () => {
			const body = JSON.stringify({
				type: 'customer.updated',
				timestamp: new Date().toISOString(),
				api_version: '2026-10'
			});

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: null });

			expect(await rows()).toHaveLength(0);
		});

		it('about a customer made in Polar by hand, who has no external id, is answered 202', async () => {
			const body = payload('customer.created', { id: 'cus_2', external_id: null });

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: null });

			expect(await rows()).toHaveLength(0);
		});

		it('of a type this version of the SDK has no name for, is answered 202', async () => {
			const id = subject();
			await addUser(db, id);
			const body = payload('widget.exploded', { external_id: id });

			expect(await take(body, signed(body))).toEqual({ status: 202, subjectId: null });

			expect(await rows()).toHaveLength(0);
		});
	});

	describe('that Polar did not send', () => {
		/** A webhook that would mark an account, which is how it is known that it did not. */
		async function aimed() {
			const id = subject();
			await addUser(db, id);
			return { id, body: payload('customer.state_changed', { external_id: id }) };
		}

		it('is refused with 403 when the body was changed after it was signed', async () => {
			const { id, body } = await aimed();
			const headers = signed(body);
			const other = await aimed();

			expect(await take(other.body, headers)).toEqual({ status: 403 });

			expect(await rowOf(id)).toBeUndefined();
			expect(await rowOf(other.id)).toBeUndefined();
		});

		it('is refused with 403 when it was signed with another secret', async () => {
			const { id, body } = await aimed();
			const other = `whsec_${Buffer.from('not-the-secret-not-the-secret-32b').toString('base64')}`;

			expect(await take(body, signed(body, { secret: other }))).toEqual({ status: 403 });

			expect(await rowOf(id)).toBeUndefined();
		});

		it('is refused with 403 when the signature is missing', async () => {
			const { id, body } = await aimed();
			const headers = signed(body);
			headers.delete('webhook-signature');

			expect(await take(body, headers)).toEqual({ status: 403 });
			expect(await rowOf(id)).toBeUndefined();
		});

		it.each(['webhook-id', 'webhook-timestamp'])(
			'is refused with 403 when %s is missing',
			async (name) => {
				const { id, body } = await aimed();
				const headers = signed(body);
				headers.delete(name);

				expect(await take(body, headers)).toEqual({ status: 403 });
				expect(await rowOf(id)).toBeUndefined();
			}
		);

		it('is refused with 403 when it has no headers at all', async () => {
			const { id, body } = await aimed();

			expect(await take(body, new Headers())).toEqual({ status: 403 });
			expect(await rowOf(id)).toBeUndefined();
		});

		it('is refused with 403 when what was signed is not JSON', async () => {
			const body = 'not json';

			expect(await take(body, signed(body))).toEqual({ status: 403 });
		});

		// This is the SDK's behaviour, not ours: its validateEvent allows a timestamp to be five
		// minutes either side of now (`webhookToleranceSeconds`), and throws "Message timestamp too
		// old" or "too new" beyond that, which this code answers as it answers any other refusal.
		// What it means for a delivery that Polar retries late is Polar's to say: nothing here
		// depends on it, since a refused delivery is only a question that is asked later anyway.
		it("is refused with 403 when its timestamp is an hour old, as the SDK's five minutes allow", async () => {
			const { id, body } = await aimed();
			const hourAgo = Math.floor(Date.now() / 1000) - 3600;

			expect(await take(body, signed(body, { timestamp: hourAgo }))).toEqual({ status: 403 });
			expect(await rowOf(id)).toBeUndefined();
		});

		it("is refused with 403 when its timestamp is an hour ahead, as the SDK's five minutes allow", async () => {
			const { body } = await aimed();
			const hourAhead = Math.floor(Date.now() / 1000) + 3600;

			expect(await take(body, signed(body, { timestamp: hourAhead }))).toEqual({ status: 403 });
		});

		it('is taken when its timestamp is a few minutes old, within what the SDK allows', async () => {
			const { id, body } = await aimed();
			const fourMinutesAgo = Math.floor(Date.now() / 1000) - 240;

			expect(await take(body, signed(body, { timestamp: fourMinutesAgo }))).toEqual({
				status: 202,
				subjectId: id
			});
		});
	});
});
