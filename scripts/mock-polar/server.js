/**
 * A fake Polar, the billing service, so that subscribing, paying, metered usage and the webhooks
 * that follow can be tried, and tested, without an account there and without a card.
 *
 * It is for development only. It runs on the developer's machine, beside the app, and the app's
 * Polar SDK is pointed at it by its `baseUrl`. Everything it knows is in this file, in memory, and
 * in a state file if it is given one. It takes the one access token below from anyone, and its
 * checkout takes a click as a payment. Nothing about it is safe to expose.
 *
 * It sells one thing: the product below, a monthly subscription that grants a fixed number of
 * credits on one meter each period, with no rollover. Its addresses:
 *
 * - POST   /v1/checkouts/                         Opens a checkout for the product.
 * - POST   /v1/customer-sessions/                 Opens a customer portal session.
 * - GET    /v1/customers/external/:id/state       The customer's subscription, benefits and meter.
 * - DELETE /v1/customers/external/:id             Deletes a customer and their subscription.
 * - POST   /v1/events/ingest                      Takes usage events.
 * - GET    /checkout/:secret                      The page a browser is sent to, to pay or not.
 * - GET    /portal/:token                         The customer portal, to cancel, cycle or trouble a
 *                                                 subscription.
 * - POST   /mock/customers/:id/:action            What the portal does, for tests: cancel, cycle,
 *                                                 past-due, recover.
 * - GET    /mock/deliveries                       The webhooks sent so far, and how they went.
 * - GET    /healthz                               Answers 200.
 *
 * What it does check is what Polar checks, where the app could get it wrong: the token, the shape
 * of a checkout and of every usage event, as Polar validates them, and the rate limit. It counts
 * usage the way Polar does, by when an event was received and not by the time the event claims,
 * and it dedupes events on their `external_id` for as long as it remembers anything. Its webhooks
 * are signed as Polar signs them, retried as Polar retries them, and sent only to this machine.
 *
 * Deliberately not here:
 *
 * - Prices, discounts, taxes and invoices. There is one product at one price, and the app never
 *   reads an amount.
 * - Periods that end on their own. A period ends when it is cycled, from the portal or the control
 *   address, so that a test or a developer can end a month in a click and not wait for one.
 * - Payment retries and dunning. A payment fails, or recovers, when the portal says so.
 * - A registry of webhook endpoints, and endpoints that are disabled after too many failures. See
 *   `webhookTarget` for where webhooks go instead.
 * - Webhooks that survive a restart. The state file keeps customers, checkouts and events. A
 *   webhook still being retried when the process stops is lost, and the app's next read of the
 *   customer's state is what puts it right.
 * - Updating or deleting an event. Polar has neither: events are immutable there.
 * - Most of the fields of the larger objects. The SDK does not validate what it is sent, so what
 *   is here is what the app reads and what a developer would look for. Every field that is here
 *   has Polar's name and type.
 *
 * It keeps two clocks. The billing model (periods, expiry, receipt of events and the rate limit)
 * keeps the `now` it is given, so that a test can let an hour pass. Webhook delivery keeps real
 * time, because it is made by real timers, to a receiver that checks the signature's timestamp
 * against its own clock and refuses one five minutes out.
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

/** The one access token it takes. */
export const TOKEN = 'mock-polar-token';

/**
 * What the app verifies its webhooks with: a valid Standard Webhooks secret, `whsec_` and the
 * base64 of 32 fixed bytes, which spell `mock-polar-webhook-secret-32byte`. A secret from nobody.
 */
export const WEBHOOK_SECRET = 'whsec_bW9jay1wb2xhci13ZWJob29rLXNlY3JldC0zMmJ5dGU=';

/** The one meter: the sum of the `units` in the metadata of every `api_call` event. */
export const METER = {
	id: '0b6f1a52-6d0e-4c53-9d53-3d4a8c1f0a01',
	name: 'API calls',
	eventName: 'api_call',
	property: 'units'
};

/** The one product: a monthly subscription that grants this many credits on the meter a period. */
export const PRODUCT = { id: '7c1e2d90-41b7-4f0a-8a2e-5b9f6c3d0b02', name: 'Pro', credits: 1000 };

/** What the product costs a month, in cents. Shown, and never charged. */
const PRICE = 2000;
/** The organisation everything belongs to, and the meter-credit benefit the product grants. */
const ORGANIZATION_ID = '3f0d9c4e-2b71-4a8e-9c55-1e6a7b2d0c03';
const BENEFIT_ID = '9a4b7e21-5c3d-4f6a-8b19-2d0e6f1c0b04';

/** The API version the SDK's 2026-10 entry point speaks, which webhooks are sent in. */
const API_VERSION = '2026-10';
/** Where the app takes its webhooks, under the origin a checkout sends the visitor back to. */
const WEBHOOK_PATH = '/api/webhooks/polar';

/** How long a checkout and a customer session last, in milliseconds, as in Polar. */
const CHECKOUT_LIFE = 3_600_000;
const SESSION_LIFE = 3_600_000;
/** How long an expired checkout or session is remembered, so that it can say it has expired. */
const EXPIRED_KEPT = 86_400_000;
/** The window the rate limit counts requests over. */
const RATE_WINDOW = 60_000;

/** The most a request body may weigh. Ingest takes up to 1,000 events, and needs far more room. */
const MOST_BODY = 64 * 1024;
const MOST_INGEST = 2 * 1024 * 1024;
/** What Polar takes in one ingest request, and in one event. */
const MOST_EVENTS = 1000;
const MOST_NAME = 128;
const MOST_METADATA_KEYS = 50;
const MOST_METADATA_KEY = 40;
const MOST_METADATA_VALUE = 500;
/** Metadata keys that Polar treats as structured data of its own. They are let through unread. */
const RESERVED_METADATA = ['_cost', '_llm'];

/** Polar's waits between attempts at a webhook: ten attempts in all, over about four minutes. */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000, 60000, 60000, 60000];
/** How long a webhook receiver has to answer, as with Polar. */
const DELIVERY_TIMEOUT = 10_000;
/** How many finished deliveries are remembered for /mock/deliveries. A backstop. */
const MOST_DELIVERIES = 1000;

/** The names a browser on this machine can call it by. `URL` writes the address one in brackets. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/**
 * @typedef {object} StoredEvent
 * @property {string} name
 * @property {string} external_customer_id
 * @property {string | null} external_id
 * @property {number} units The meter's property, or 0 where the event does not carry a number in it.
 * @property {number} received When it was ingested, by the mock's clock.
 */

/**
 * @typedef {object} Subscription
 * @property {string} id
 * @property {'active' | 'past_due'} status
 * @property {number} created
 * @property {number} modified
 * @property {number} periodStart
 * @property {number} periodEnd
 * @property {number} countFrom The index of the first stored event that counts in this period.
 * @property {number | null} pastDueAt
 * @property {string} checkoutId
 * @property {string} meterId The subscription's own meter, as `active_subscriptions` lists it.
 * @property {string} grantId
 * @property {number} creditedAt When this period's credits were granted.
 */

/**
 * @typedef {object} Customer
 * @property {string} id
 * @property {string} externalId
 * @property {string} email
 * @property {string | null} name
 * @property {number} created
 * @property {string} meterId The customer's meter, as `active_meters` lists it.
 * @property {Subscription | null} subscription There is at most one, active or past due.
 */

/**
 * @typedef {object} Checkout
 * @property {string} id
 * @property {string} secret
 * @property {string} url
 * @property {number} created
 * @property {number | null} modified
 * @property {number} expires
 * @property {'open' | 'succeeded' | 'failed'} status
 * @property {string} successUrl With the checkout's id put in for `{CHECKOUT_ID}`.
 * @property {string | null} returnUrl
 * @property {string | null} email
 * @property {string | null} name
 * @property {string} externalCustomerId
 * @property {string | null} customerId
 */

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} token
 * @property {number} created
 * @property {number} expires
 * @property {string | null} returnUrl
 * @property {string} externalCustomerId
 */

/**
 * What the state file holds. Lists, and not objects keyed by id, because an id is the app's to
 * choose and `__proto__` is a valid one.
 *
 * @typedef {object} Saved
 * @property {1} version
 * @property {string | null} webhookTarget
 * @property {Customer[]} customers
 * @property {Checkout[]} checkouts
 * @property {Session[]} sessions
 * @property {StoredEvent[]} events Oldest first, and never removed.
 */

/**
 * @typedef {object} Delivery
 * @property {string} id The webhook's id, which every attempt at it repeats.
 * @property {string} type
 * @property {string} target
 * @property {string} body
 * @property {number} attempts
 * @property {boolean} delivered
 * @property {number | null} status The last attempt's HTTP status, or null if there was no answer.
 * @property {string | null} error Why the last attempt had no answer.
 * @property {number | null} next When to try again, in real time, or null once it is settled.
 */

/** @typedef {{ loc: (string | number)[], msg: string, type: string }} Issue */

/** @typedef {'cancel' | 'cycle' | 'past-due' | 'recover'} Action */
const ACTIONS = /** @type {const} */ (['cancel', 'cycle', 'past-due', 'recover']);

/**
 * Starts a mock server and does not listen: the caller chooses the port.
 *
 * @param {object} [options]
 * @param {() => number} [options.now] The billing model's clock, in milliseconds, so that a test
 *   can let a checkout expire or a minute pass without waiting for it.
 * @param {string} [options.stateFile] Where to keep state across restarts. It is read now, and
 *   written after every change. A file that is not there is no state yet; one that cannot be read
 *   is an error, thrown here.
 * @param {string} [options.webhookUrl] Where to send every webhook, in place of the address
 *   worked out from checkouts (see `webhookTarget`).
 * @param {number} [options.requestsPerMinute] The rate limit on /v1, over a rolling minute.
 * @param {number[]} [options.retryDelays] The waits between attempts at a webhook, in milliseconds.
 *   One more attempt is made than there are waits.
 * @returns {import('node:http').Server}
 */
export function createMockPolar({
	now = Date.now,
	stateFile,
	webhookUrl,
	requestsPerMinute = 500,
	retryDelays = RETRY_DELAYS
} = {}) {
	if (webhookUrl !== undefined && !httpUrl(webhookUrl)) {
		throw new Error(`mock-polar: webhookUrl must be an http or https address, not ${webhookUrl}.`);
	}

	const saved = stateFile === undefined ? empty() : load(stateFile);
	/** @type {Map<string, Customer>} By external id. */
	const customers = new Map(saved.customers.map((customer) => [customer.externalId, customer]));
	/** @type {Map<string, Checkout>} By client secret. */
	const checkouts = new Map(saved.checkouts.map((checkout) => [checkout.secret, checkout]));
	/** @type {Map<string, Session>} By token. */
	const sessions = new Map(saved.sessions.map((session) => [session.token, session]));
	const events = saved.events;
	/** Every `external_id` ever ingested, which is what a new event is a duplicate of. */
	const seen = new Set(events.flatMap((event) => event.external_id ?? []));
	let rememberedTarget = saved.webhookTarget;

	/** Writes the state out whole, to a file beside it first, so that a crash leaves one or the other. */
	function save() {
		if (stateFile === undefined) return;
		/** @type {Saved} */
		const state = {
			version: 1,
			webhookTarget: rememberedTarget,
			customers: [...customers.values()],
			checkouts: [...checkouts.values()],
			sessions: [...sessions.values()],
			events
		};
		const temporary = `${stateFile}.${process.pid}.tmp`;
		writeFileSync(temporary, JSON.stringify(state));
		renameSync(temporary, stateFile);
	}

	/**
	 * Forgets checkouts and sessions that expired more than a day ago, so that a long session does
	 * not grow without end. One expired more recently is kept, to say that it has expired.
	 */
	function forget() {
		const before = now() - EXPIRED_KEPT;
		for (const [secret, checkout] of checkouts) {
			if (checkout.expires < before) checkouts.delete(secret);
		}
		for (const [token, session] of sessions) {
			if (session.expires < before) sessions.delete(token);
		}
	}

	// The rate limit. Requests answered, by the mock's clock, oldest first.
	/** @type {number[]} */
	const recent = [];

	/** Counts a request, and returns 0, or how many seconds to wait if it is over the limit. */
	function limited() {
		const time = now();
		while (recent.length > 0 && recent[0] <= time - RATE_WINDOW) recent.shift();
		if (recent.length >= requestsPerMinute) {
			return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW - time) / 1000));
		}
		recent.push(time);
		return 0;
	}

	// Webhooks. A real Polar has the endpoint registered. This one has no registry, and takes the
	// app to be wherever the most recent checkout asked for the visitor to be sent back to, at the
	// path the app takes webhooks on. It remembers that only when the address is on this machine,
	// as the OAuth mock does with its redirects and for the same reason: nothing it sends may go
	// anywhere else. Until it knows of an app, nothing is queued at all, as with a Polar that has no
	// endpoint registered.
	/** @type {Delivery[]} Oldest first. */
	const deliveries = [];
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let sending = false;
	let closed = false;
	const stopping = new AbortController();

	function webhookTarget() {
		return webhookUrl ?? rememberedTarget;
	}

	/**
	 * Queues a webhook for the app, if an app is known.
	 *
	 * @param {string} type
	 * @param {unknown} data
	 */
	function emit(type, data) {
		const target = webhookTarget();
		if (target === null) return;
		deliveries.push({
			id: randomUUID(),
			type,
			target,
			body: JSON.stringify({ type, timestamp: iso(now()), api_version: API_VERSION, data }),
			attempts: 0,
			delivered: false,
			status: null,
			error: null,
			next: Date.now()
		});
		// Forgets the oldest of those that are settled, if there are too many to list.
		let excess = deliveries.length - MOST_DELIVERIES;
		for (let index = 0; excess > 0 && index < deliveries.length; ) {
			if (deliveries[index].next === null) {
				deliveries.splice(index, 1);
				excess--;
			} else {
				index++;
			}
		}
		send();
	}

	/**
	 * Sends the oldest webhook that is due, one at a time, and then the next. One that has failed
	 * waits out its delay while those behind it go ahead, so their order is kept only while nothing
	 * fails, as with Polar.
	 */
	function send() {
		if (sending || closed) return;
		clearTimeout(timer);
		timer = undefined;

		const time = Date.now();
		const due = deliveries.find((delivery) => delivery.next !== null && delivery.next <= time);
		if (!due) {
			const waits = deliveries.flatMap((delivery) => delivery.next ?? []);
			if (waits.length > 0) {
				// Unref'd, so that a webhook waiting to be retried does not keep the process alive.
				timer = setTimeout(send, Math.min(...waits) - time);
				timer.unref();
			}
			return;
		}

		sending = true;
		attempt(due).finally(() => {
			sending = false;
			send();
		});
	}

	/** @param {Delivery} delivery */
	async function attempt(delivery) {
		delivery.attempts++;
		delivery.status = null;
		delivery.error = null;
		try {
			const response = await fetch(delivery.target, {
				method: 'POST',
				headers: {
					...signWebhook(WEBHOOK_SECRET, delivery.id, Math.floor(Date.now() / 1000), delivery.body),
					'webhook-api-version': API_VERSION,
					'user-agent': 'mock-polar'
				},
				body: delivery.body,
				// A redirect is a failure, as with Polar: the endpoint is the address it was given.
				redirect: 'manual',
				signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(DELIVERY_TIMEOUT)])
			});
			delivery.status = response.status;
			await response.body?.cancel();
		} catch (failure) {
			// A refused connection or a timeout is a failure like any other answer but a 2xx, and is
			// retried. What it was is kept, for /mock/deliveries to show.
			delivery.error = failure instanceof Error ? failure.message : String(failure);
		}

		if (delivery.status !== null && delivery.status >= 200 && delivery.status < 300) {
			delivery.delivered = true;
			delivery.next = null;
		} else if (delivery.attempts > retryDelays.length) {
			delivery.next = null;
			if (!closed) {
				console.warn(
					`mock-polar: gave up on webhook ${delivery.type} ${delivery.id} to ${delivery.target} ` +
						`after ${delivery.attempts} attempts; the last: ${delivery.error ?? delivery.status}.`
				);
			}
		} else {
			delivery.next = Date.now() + retryDelays[delivery.attempts - 1];
		}
	}

	// What things look like from outside, in Polar's shapes.

	/**
	 * @param {Customer} customer
	 * @param {number | null} [deletedAt]
	 */
	function customerData(customer, deletedAt = null) {
		return {
			id: customer.id,
			created_at: iso(customer.created),
			modified_at: null,
			metadata: {},
			external_id: customer.externalId,
			email: customer.email,
			email_verified: false,
			type: 'individual',
			name: customer.name,
			billing_name: null,
			billing_address: null,
			tax_id: null,
			organization_id: ORGANIZATION_ID,
			deleted_at: deletedAt === null ? null : iso(deletedAt),
			first_user_event_at: null,
			avatar_url: null
		};
	}

	/**
	 * What the subscription's meter has used this period: the meter's property summed over its
	 * events for the customer received since the period began. Receipt is counted by the order
	 * events arrived in, which is receipt time without a clock's ties, so an event received in the
	 * same millisecond as a cycle is never counted in both periods or in neither.
	 *
	 * @param {Customer} customer
	 * @param {Subscription} subscription
	 */
	function usage(customer, subscription) {
		let consumed = 0;
		/** @type {number | null} */
		let last = null;
		for (let index = subscription.countFrom; index < events.length; index++) {
			const event = events[index];
			if (event.external_customer_id === customer.externalId && event.name === METER.eventName) {
				consumed += event.units;
				last = event.received;
			}
		}
		const credited = PRODUCT.credits;
		return { consumed, credited, balance: credited - consumed, modified: last };
	}

	/** @param {Subscription} subscription */
	function credits(subscription) {
		return {
			last_credited_meter_id: METER.id,
			last_credited_units: PRODUCT.credits,
			last_credited_at: iso(subscription.creditedAt)
		};
	}

	/**
	 * What `GET /v1/customers/external/:id/state` answers, and `customer.state_changed` carries. A
	 * subscription that is past due is not active, and its meter is not either; the benefit it
	 * granted stands until the subscription is revoked, as in Polar.
	 *
	 * @param {Customer} customer
	 */
	function stateOf(customer) {
		const subscription = customer.subscription;
		const active = subscription?.status === 'active' ? subscription : null;
		const used = active ? usage(customer, active) : null;
		return {
			...customerData(customer),
			active_subscriptions:
				active && used
					? [
							{
								id: active.id,
								created_at: iso(active.created),
								modified_at: iso(active.modified),
								metadata: {},
								status: 'active',
								amount: PRICE,
								currency: 'usd',
								recurring_interval: 'month',
								current_period_start: iso(active.periodStart),
								current_period_end: iso(active.periodEnd),
								trial_start: null,
								trial_end: null,
								cancel_at_period_end: false,
								canceled_at: null,
								started_at: iso(active.created),
								ends_at: null,
								product_id: PRODUCT.id,
								discount_id: null,
								seats: null,
								units: null,
								meters: [
									{
										id: active.meterId,
										created_at: iso(active.created),
										modified_at: used.modified === null ? null : iso(used.modified),
										consumed_units: used.consumed,
										credited_units: used.credited,
										amount: 0,
										meter_id: METER.id
									}
								]
							}
						]
					: [],
			granted_benefits: subscription
				? [
						{
							id: subscription.grantId,
							created_at: iso(subscription.created),
							modified_at: iso(subscription.creditedAt),
							granted_at: iso(subscription.created),
							benefit_id: BENEFIT_ID,
							benefit_type: 'meter_credit',
							benefit_metadata: {},
							properties: credits(subscription)
						}
					]
				: [],
			active_meters:
				active && used
					? [
							{
								id: customer.meterId,
								created_at: iso(customer.created),
								modified_at: used.modified === null ? null : iso(used.modified),
								meter_id: METER.id,
								consumed_units: used.consumed,
								credited_units: used.credited,
								balance: used.balance
							}
						]
					: []
		};
	}

	/**
	 * @param {Customer} customer
	 * @param {Subscription} subscription
	 * @param {number | null} [endedAt] When it was canceled, for the webhooks that say so.
	 */
	function subscriptionData(customer, subscription, endedAt = null) {
		const ended = endedAt === null ? null : iso(endedAt);
		return {
			created_at: iso(subscription.created),
			modified_at: iso(endedAt ?? subscription.modified),
			id: subscription.id,
			amount: PRICE,
			currency: 'usd',
			recurring_interval: 'month',
			recurring_interval_count: 1,
			status: endedAt === null ? subscription.status : 'canceled',
			current_period_start: iso(subscription.periodStart),
			current_period_end: iso(subscription.periodEnd),
			current_meter_period_start: iso(subscription.periodStart),
			current_meter_period_end: iso(subscription.periodEnd),
			trial_start: null,
			trial_end: null,
			cancel_at_period_end: false,
			canceled_at: ended,
			started_at: iso(subscription.created),
			ends_at: ended,
			ended_at: ended,
			past_due_at: subscription.pastDueAt === null ? null : iso(subscription.pastDueAt),
			pause_at_period_end: false,
			paused_at: null,
			resumes_at: null,
			customer_id: customer.id,
			product_id: PRODUCT.id,
			discount_id: null,
			checkout_id: subscription.checkoutId,
			units: null,
			customer_cancellation_reason: null,
			customer_cancellation_comment: null,
			metadata: {},
			customer: customerData(customer)
		};
	}

	/**
	 * @param {Customer} customer
	 * @param {Subscription} subscription
	 * @param {number | null} [revokedAt]
	 */
	function grantData(customer, subscription, revokedAt = null) {
		return {
			created_at: iso(subscription.created),
			modified_at: iso(revokedAt ?? subscription.creditedAt),
			id: subscription.grantId,
			granted_at: iso(subscription.created),
			is_granted: revokedAt === null,
			revoked_at: revokedAt === null ? null : iso(revokedAt),
			is_revoked: revokedAt !== null,
			subscription_id: subscription.id,
			order_id: null,
			customer_id: customer.id,
			benefit_id: BENEFIT_ID,
			customer: customerData(customer),
			properties: credits(subscription)
		};
	}

	/** @param {Checkout} checkout */
	function checkoutData(checkout) {
		return {
			id: checkout.id,
			created_at: iso(checkout.created),
			modified_at: checkout.modified === null ? null : iso(checkout.modified),
			payment_processor: 'stripe',
			status: checkout.status,
			client_secret: checkout.secret,
			url: checkout.url,
			expires_at: iso(checkout.expires),
			success_url: checkout.successUrl,
			return_url: checkout.returnUrl,
			embed_origin: null,
			amount: PRICE,
			discount_amount: 0,
			net_amount: PRICE,
			tax_amount: null,
			total_amount: PRICE,
			currency: 'usd',
			organization_id: ORGANIZATION_ID,
			product_id: PRODUCT.id,
			is_payment_required: true,
			customer_id: checkout.customerId,
			customer_name: checkout.name,
			customer_email: checkout.email,
			external_customer_id: checkout.externalCustomerId,
			metadata: {},
			customer_metadata: {}
		};
	}

	/**
	 * Queues `order.created` and `order.paid` for a period's payment, which is taken at once.
	 *
	 * @param {Customer} customer
	 * @param {Subscription} subscription
	 * @param {'subscription_create' | 'subscription_cycle'} reason
	 */
	function order(customer, subscription, reason) {
		const id = randomUUID();
		const created = iso(now());
		for (const [type, status] of [
			['order.created', 'pending'],
			['order.paid', 'paid']
		]) {
			emit(type, {
				id,
				created_at: created,
				modified_at: status === 'paid' ? created : null,
				status,
				paid: status === 'paid',
				subtotal_amount: PRICE,
				discount_amount: 0,
				net_amount: PRICE,
				tax_amount: 0,
				total_amount: PRICE,
				applied_balance_amount: 0,
				due_amount: status === 'paid' ? 0 : PRICE,
				refunded_amount: 0,
				refunded_tax_amount: 0,
				currency: 'usd',
				billing_reason: reason,
				billing_name: null,
				billing_address: null,
				invoice_number: null,
				is_invoice_generated: false,
				receipt_number: null,
				units: null,
				customer_id: customer.id,
				product_id: PRODUCT.id,
				discount_id: null,
				subscription_id: subscription.id,
				checkout_id: reason === 'subscription_create' ? subscription.checkoutId : null,
				metadata: {},
				platform_fee_amount: 0,
				platform_fee_currency: null,
				customer: customerData(customer),
				description: PRODUCT.name,
				refundable_amount: status === 'paid' ? PRICE : 0,
				refundable_tax_amount: 0
			});
		}
	}

	// What happens.

	/**
	 * Takes payment for a checkout: the customer, made if they are new, gets the subscription, its
	 * first period and that period's credits. A customer who already has a subscription is not
	 * given a second, and the checkout is left as it was: the app keeps one a customer.
	 *
	 * @param {Checkout} checkout
	 */
	function pay(checkout) {
		const existing = customers.get(checkout.externalCustomerId);
		if (existing?.subscription) return;

		const time = now();
		const customer = existing ?? {
			id: randomUUID(),
			externalId: checkout.externalCustomerId,
			email: checkout.email ?? `${checkout.externalCustomerId}@mock.invalid`,
			name: checkout.name,
			created: time,
			meterId: randomUUID(),
			subscription: null
		};
		customers.set(customer.externalId, customer);

		checkout.status = 'succeeded';
		checkout.modified = time;
		checkout.customerId = customer.id;

		/** @type {Subscription} */
		const subscription = {
			id: randomUUID(),
			status: 'active',
			created: time,
			modified: time,
			periodStart: time,
			periodEnd: addMonth(time),
			countFrom: events.length,
			pastDueAt: null,
			checkoutId: checkout.id,
			meterId: randomUUID(),
			grantId: randomUUID(),
			creditedAt: time
		};
		customer.subscription = subscription;

		emit('checkout.updated', checkoutData(checkout));
		if (!existing) emit('customer.created', customerData(customer));
		emit('subscription.created', subscriptionData(customer, subscription));
		emit('subscription.active', subscriptionData(customer, subscription));
		order(customer, subscription, 'subscription_create');
		emit('benefit_grant.created', grantData(customer, subscription));
		emit('customer.state_changed', stateOf(customer));
	}

	/**
	 * Does what the portal and the control addresses offer. Returns why not, if it makes no sense
	 * for the subscription as it stands.
	 *
	 * @param {Customer} customer
	 * @param {Action} action
	 * @returns {string | undefined}
	 */
	function act(customer, action) {
		const subscription = customer.subscription;
		const time = now();

		if (action === 'cancel') {
			// Ends it now, and not at the period's end: that is the case the app has to handle.
			if (!subscription) return 'There is no subscription to cancel.';
			customer.subscription = null;
			emit('subscription.canceled', subscriptionData(customer, subscription, time));
			emit('subscription.revoked', subscriptionData(customer, subscription, time));
			emit('benefit_grant.revoked', grantData(customer, subscription, time));
		} else if (action === 'cycle') {
			if (subscription?.status !== 'active') return 'Only an active subscription can be cycled.';
			// The next period follows on from the last, unless the last has not ended yet, in which
			// case it is cut short. Either way usage counts afresh from now: what was received before
			// the cycle belonged to the period that has ended.
			subscription.periodStart = Math.min(subscription.periodEnd, time);
			subscription.periodEnd = addMonth(subscription.periodStart);
			subscription.countFrom = events.length;
			subscription.creditedAt = time;
			subscription.modified = time;
			order(customer, subscription, 'subscription_cycle');
			emit('subscription.cycled', subscriptionData(customer, subscription));
			emit('benefit_grant.cycled', grantData(customer, subscription));
		} else if (action === 'past-due') {
			if (subscription?.status !== 'active') return 'Only an active subscription can fall due.';
			subscription.status = 'past_due';
			subscription.pastDueAt = time;
			subscription.modified = time;
			emit('subscription.past_due', subscriptionData(customer, subscription));
		} else {
			if (subscription?.status !== 'past_due') return 'Only a past due subscription can recover.';
			// The same period goes on, and what was used while it was past due counts in it.
			subscription.status = 'active';
			subscription.pastDueAt = null;
			subscription.modified = time;
			emit('subscription.active', subscriptionData(customer, subscription));
		}

		emit('customer.state_changed', stateOf(customer));
		save();
	}

	// The addresses.

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 */
	async function handle(request, response) {
		let url;
		/** @type {string[]} */
		let path;
		try {
			url = new URL(request.url ?? '', 'http://mock');
			// With or without a trailing slash: the SDK writes some addresses with one and some without.
			path = url.pathname.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent);
		} catch {
			return fail(response, 400, 'BadRequest', 'The request address could not be read.');
		}
		const [area, ...rest] = path;

		if (area === 'healthz' && rest.length === 0) {
			if (!only(request, response, 'GET')) return;
			return json(response, 200, { status: 'ok' });
		}
		if (area === 'v1') {
			if (!authorised(request)) return unauthorised(response);
			const wait = limited();
			if (wait > 0) {
				return fail(response, 429, 'TooManyRequests', 'Too many requests. Wait and try again.', {
					'retry-after': String(wait)
				});
			}
			return api(request, response, rest);
		}
		if (area === 'mock') {
			if (!authorised(request)) return unauthorised(response);
			return control(request, response, rest);
		}
		if (area === 'checkout') return checkoutPage(request, response, rest);
		if (area === 'portal') return portalPage(request, response, rest);
		return notFound(response);
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 * @param {string[]} path
	 */
	async function api(request, response, path) {
		const [first, second, third, fourth, ...extra] = path;
		if (extra.length > 0) return notFound(response);

		if (first === 'checkouts' && second === undefined) {
			if (!only(request, response, 'POST')) return;
			return createCheckout(request, response);
		}
		if (first === 'customer-sessions' && second === undefined) {
			if (!only(request, response, 'POST')) return;
			return createSession(request, response);
		}
		if (first === 'events' && second === 'ingest' && third === undefined) {
			if (!only(request, response, 'POST')) return;
			return ingest(request, response);
		}
		if (first === 'customers' && second === 'external' && third !== undefined) {
			if (fourth === undefined) {
				if (!only(request, response, 'DELETE')) return;
				return deleteCustomer(response, third);
			}
			if (fourth === 'state') {
				if (!only(request, response, 'GET')) return;
				const customer = customers.get(third);
				if (!customer) return fail(response, 404, 'ResourceNotFound', 'Customer not found.');
				return json(response, 200, stateOf(customer));
			}
		}
		return notFound(response);
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 */
	async function createCheckout(request, response) {
		const body = await readJson(request, response, MOST_BODY);
		if (body === undefined) return;

		/** @type {Issue[]} */
		const issues = [];
		if (!isObject(body)) return invalid(response, [notAnObject(['body'])]);
		const products = body.products;
		if (!Array.isArray(products) || products.length !== 1 || products[0] !== PRODUCT.id) {
			issues.push({
				loc: ['body', 'products'],
				msg: `This mock sells one product: products must be ["${PRODUCT.id}"].`,
				type: 'value_error'
			});
		}
		// Polar does not need it. This mock does: it knows customers only by the app's id for them,
		// and the app always sends one.
		const externalId = text(body.external_customer_id, ['body', 'external_customer_id'], issues, {
			required: true,
			min: 1
		});
		const successUrl = address(body.success_url, ['body', 'success_url'], issues, true);
		const returnUrl = address(body.return_url, ['body', 'return_url'], issues, false);
		const email = text(body.customer_email, ['body', 'customer_email'], issues);
		const name = text(body.customer_name, ['body', 'customer_name'], issues);
		const origin = originOf(request);
		if (origin === null) {
			return fail(response, 400, 'BadRequest', 'The Host header is not a host and port.');
		}
		if (issues.length > 0 || !externalId || !successUrl) return invalid(response, issues);

		forget();
		const time = now();
		const id = randomUUID();
		const secret = `polar_c_${randomBytes(24).toString('base64url')}`;
		/** @type {Checkout} */
		const checkout = {
			id,
			secret,
			url: `${origin}/checkout/${encodeURIComponent(secret)}`,
			created: time,
			modified: null,
			expires: time + CHECKOUT_LIFE,
			status: 'open',
			successUrl: successUrl.replaceAll('{CHECKOUT_ID}', id),
			returnUrl: returnUrl ?? null,
			email: email ?? null,
			name: name ?? null,
			externalCustomerId: externalId,
			customerId: null
		};
		checkouts.set(secret, checkout);

		const back = new URL(checkout.successUrl);
		if (LOOPBACK.includes(back.hostname)) rememberedTarget = `${back.origin}${WEBHOOK_PATH}`;

		save();
		json(response, 201, checkoutData(checkout));
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 */
	async function createSession(request, response) {
		const body = await readJson(request, response, MOST_BODY);
		if (body === undefined) return;
		if (!isObject(body)) return invalid(response, [notAnObject(['body'])]);

		/** @type {Issue[]} */
		const issues = [];
		const externalId = byExternalId(body, ['body'], issues);
		const returnUrl = address(body.return_url, ['body', 'return_url'], issues, false);
		const origin = originOf(request);
		if (origin === null) {
			return fail(response, 400, 'BadRequest', 'The Host header is not a host and port.');
		}
		if (issues.length > 0 || !externalId) return invalid(response, issues);

		// A customer it does not know is a fault in the body here, and not a 404: Polar's API lists
		// only 409 and 422 for this address, and the SDK maps only those.
		const customer = customers.get(externalId);
		if (!customer) {
			return invalid(response, [
				{
					loc: ['body', 'external_customer_id'],
					msg: 'Customer does not exist.',
					type: 'value_error'
				}
			]);
		}

		forget();
		const time = now();
		/** @type {Session} */
		const session = {
			id: randomUUID(),
			token: `polar_cst_${randomBytes(24).toString('base64url')}`,
			created: time,
			expires: time + SESSION_LIFE,
			returnUrl: returnUrl ?? null,
			externalCustomerId: externalId
		};
		sessions.set(session.token, session);
		save();

		json(response, 201, {
			created_at: iso(session.created),
			modified_at: null,
			id: session.id,
			token: session.token,
			expires_at: iso(session.expires),
			return_url: session.returnUrl,
			customer_portal_url: `${origin}/portal/${encodeURIComponent(session.token)}`,
			customer_id: customer.id,
			customer: customerData(customer)
		});
	}

	/**
	 * Takes usage events, after checking every one of them as Polar does: one that is wrong refuses
	 * the whole request, and none of it is kept.
	 *
	 * An event for a customer this mock does not know yet is accepted and kept, and counts if that
	 * customer subscribes later, though only what arrives after they do. What Polar does with one is
	 * not documented; taking it is what keeps usage recorded before a webhook has caught up from
	 * being refused.
	 *
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 */
	async function ingest(request, response) {
		const body = await readJson(request, response, MOST_INGEST);
		if (body === undefined) return;

		/** @type {Issue[]} */
		const issues = [];
		const list = isObject(body) ? body.events : undefined;
		if (!isObject(body)) {
			issues.push(notAnObject(['body']));
		} else if (list === undefined) {
			issues.push({ loc: ['body', 'events'], msg: 'Field required', type: 'missing' });
		} else if (!Array.isArray(list)) {
			issues.push({
				loc: ['body', 'events'],
				msg: 'Input should be a valid list',
				type: 'list_type'
			});
		} else if (list.length > MOST_EVENTS) {
			issues.push({
				loc: ['body', 'events'],
				msg: `List should have at most ${MOST_EVENTS} items after validation, not ${list.length}`,
				type: 'too_long'
			});
		} else {
			for (const [index, event] of list.entries()) {
				checkEvent(event, ['body', 'events', index], issues);
			}
		}
		if (issues.length > 0 || !Array.isArray(list)) return invalid(response, issues);

		let inserted = 0;
		let duplicates = 0;
		const time = now();
		for (const event of /** @type {Record<string, unknown>[]} */ (list)) {
			const externalId = typeof event.external_id === 'string' ? event.external_id : null;
			if (externalId !== null) {
				if (seen.has(externalId)) {
					duplicates++;
					continue;
				}
				seen.add(externalId);
			}
			const metadata = isObject(event.metadata) ? event.metadata : {};
			const units = metadata[METER.property];
			events.push({
				name: /** @type {string} */ (event.name),
				external_customer_id: /** @type {string} */ (event.external_customer_id),
				external_id: externalId,
				units: typeof units === 'number' ? units : 0,
				received: time
			});
			inserted++;
		}
		// No webhook: Polar has none for usage, and a customer's state does not change with it.
		if (inserted > 0) save();
		json(response, 200, { inserted, duplicates });
	}

	/**
	 * @param {import('node:http').ServerResponse} response
	 * @param {string} externalId
	 */
	function deleteCustomer(response, externalId) {
		const customer = customers.get(externalId);
		if (!customer) return fail(response, 404, 'ResourceNotFound', 'Customer not found.');
		customers.delete(externalId);
		// Their events stay, as in Polar, where events cannot be deleted.
		emit('customer.deleted', customerData(customer, now()));
		save();
		response.writeHead(204).end();
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 * @param {string[]} path
	 */
	function control(request, response, path) {
		const [first, externalId, action, ...extra] = path;
		if (extra.length > 0) return notFound(response);

		if (first === 'deliveries' && externalId === undefined) {
			if (!only(request, response, 'GET')) return;
			return json(response, 200, {
				items: deliveries.map((delivery) => ({
					id: delivery.id,
					type: delivery.type,
					attempts: delivery.attempts,
					delivered: delivery.delivered,
					last_status: delivery.status,
					last_error: delivery.error,
					next_attempt_at: delivery.next === null ? null : iso(delivery.next)
				}))
			});
		}
		if (first === 'customers' && externalId !== undefined && isAction(action)) {
			if (!only(request, response, 'POST')) return;
			const customer = customers.get(externalId);
			if (!customer) return fail(response, 404, 'ResourceNotFound', 'Customer not found.');
			const conflict = act(customer, action);
			if (conflict) return fail(response, 409, 'Conflict', conflict);
			return response.writeHead(204).end();
		}
		return notFound(response);
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 * @param {string[]} path
	 */
	function checkoutPage(request, response, path) {
		const [secret, action, ...extra] = path;
		if (secret === undefined || extra.length > 0) return missingPage(response);
		const checkout = checkouts.get(secret);
		if (!checkout) return missingPage(response);

		if (action === undefined) {
			if (!only(request, response, 'GET')) return;
		} else if (action === 'pay' || action === 'fail' || action === 'abandon') {
			if (!only(request, response, 'POST')) return;
		} else {
			return missingPage(response);
		}

		if (checkout.status !== 'open' || checkout.expires <= now()) {
			const why =
				checkout.status === 'succeeded'
					? 'This checkout has been paid already.'
					: checkout.status === 'failed'
						? 'The payment for this checkout failed. Start a new checkout to try again.'
						: 'This checkout has expired. Start a new one.';
			return page(response, 410, 'Checkout closed', html`<p>${why}</p>`);
		}

		if (action === 'pay') {
			pay(checkout);
			save();
			return redirect(response, checkout.successUrl);
		}
		if (action === 'fail') {
			checkout.status = 'failed';
			checkout.modified = now();
			emit('checkout.updated', checkoutData(checkout));
			save();
			if (checkout.returnUrl) return redirect(response, checkout.returnUrl);
			return page(response, 200, 'Payment failed', html`<p>Nothing was charged.</p>`);
		}
		if (action === 'abandon') {
			if (checkout.returnUrl) return redirect(response, checkout.returnUrl);
			return page(response, 200, 'Checkout left', html`<p>It is still open, until it expires.</p>`);
		}

		const base = `/checkout/${encodeURIComponent(secret)}`;
		page(
			response,
			200,
			`Subscribe to ${PRODUCT.name}`,
			html`<p>${money(PRICE)} a month, with ${PRODUCT.credits} ${METER.name.toLowerCase()} each month.</p>
				<p>For ${checkout.email ?? checkout.externalCustomerId}${checkout.name ? html` (${checkout.name})` : ''}.</p>
				<p>This is the mock Polar. Nothing is charged, whichever is pressed.</p>
				${button(`${base}/pay`, 'Pay')} ${button(`${base}/fail`, 'Payment fails')}
				${button(`${base}/abandon`, 'Abandon')}`
		);
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 * @param {string[]} path
	 */
	function portalPage(request, response, path) {
		const [token, action, ...extra] = path;
		if (token === undefined || extra.length > 0) return missingPage(response);
		const session = sessions.get(token);
		const customer = session && customers.get(session.externalCustomerId);
		if (!session || session.expires <= now() || !customer) return missingPage(response);

		const base = `/portal/${encodeURIComponent(token)}`;
		if (action !== undefined) {
			if (!isAction(action)) return missingPage(response);
			if (!only(request, response, 'POST')) return;
			const conflict = act(customer, action);
			if (conflict) {
				return page(
					response,
					409,
					'Not now',
					html`<p>${conflict}</p><p><a href="${base}">Back</a></p>`
				);
			}
			return redirect(response, base);
		}
		if (!only(request, response, 'GET')) return;

		const subscription = customer.subscription;
		const used = subscription ? usage(customer, subscription) : null;
		const back = session.returnUrl
			? html`<p><a href="${session.returnUrl}">Back to the app</a></p>`
			: '';
		page(
			response,
			200,
			'Customer portal',
			html`<p>${customer.email}</p>
				${
					subscription && used
						? html`<p>${PRODUCT.name}: <strong>${subscription.status.replace('_', ' ')}</strong>,
							${day(subscription.periodStart)} to ${day(subscription.periodEnd)}.</p>
							<p>${METER.name}: ${used.consumed} used of ${used.credited}, ${used.balance} left.</p>`
						: html`<p>No subscription.</p>`
				}
				${button(`${base}/cancel`, 'Cancel subscription')}
				${button(`${base}/cycle`, 'End the billing period now')}
				${button(`${base}/past-due`, 'Payment fails')}
				${button(`${base}/recover`, 'Payment recovers')}
				${back}`
		);
	}

	const server = createServer((request, response) => {
		// The handler is async, and a request that throws must not end the process. Its failure is
		// the server's own, so it is recorded here and the caller is told as much.
		handle(request, response).catch((error) => {
			console.error('mock-polar: a request failed:', error);
			if (response.headersSent) response.destroy();
			else fail(response, 500, 'InternalServerError', 'The mock server failed.');
		});
	});
	// Nothing is sent once it has closed, and a webhook on its way is called back, so that a test
	// or the process can end at once.
	server.on('close', () => {
		closed = true;
		clearTimeout(timer);
		stopping.abort();
	});
	return server;
}

/**
 * The headers that sign a webhook as Standard Webhooks, and so Polar, sign one: an HMAC-SHA256 of
 * the id, the timestamp and the body, keyed by the base64-decoded secret after its `whsec_`.
 *
 * @param {string} secret
 * @param {string} id
 * @param {number} timestampSeconds
 * @param {string} body
 */
export function signWebhook(secret, id, timestampSeconds, body) {
	const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
	const signature = createHmac('sha256', key)
		.update(`${id}.${timestampSeconds}.${body}`)
		.digest('base64');
	return {
		'content-type': 'application/json',
		'webhook-id': id,
		'webhook-timestamp': String(timestampSeconds),
		'webhook-signature': `v1,${signature}`
	};
}

/** @returns {Saved} */
function empty() {
	return {
		version: 1,
		webhookTarget: null,
		customers: [],
		checkouts: [],
		sessions: [],
		events: []
	};
}

/**
 * The state in the file, or none if there is no file. A file that is there and cannot be read, or
 * is not what this wrote, is an error: carrying on without it would quietly lose every customer.
 *
 * @param {string} file
 * @returns {Saved}
 */
function load(file) {
	let content;
	try {
		content = readFileSync(file, 'utf8');
	} catch (failure) {
		if (/** @type {NodeJS.ErrnoException} */ (failure).code === 'ENOENT') return empty();
		throw new Error(`mock-polar: the state file ${file} could not be read.`, { cause: failure });
	}
	let saved;
	try {
		saved = JSON.parse(content);
	} catch (failure) {
		throw new Error(`mock-polar: the state file ${file} is not JSON.`, { cause: failure });
	}
	const lists = ['customers', 'checkouts', 'sessions', 'events'];
	if (
		!isObject(saved) ||
		saved.version !== 1 ||
		!(saved.webhookTarget === null || typeof saved.webhookTarget === 'string') ||
		!lists.every((name) => Array.isArray(saved[name]))
	) {
		throw new Error(`mock-polar: the state file ${file} is not one this mock wrote.`);
	}
	return /** @type {Saved} */ (/** @type {unknown} */ (saved));
}

/**
 * The checks Polar makes of one usage event, as far as the app can get them wrong.
 *
 * @param {unknown} event
 * @param {(string | number)[]} loc
 * @param {Issue[]} issues
 */
function checkEvent(event, loc, issues) {
	if (!isObject(event)) {
		issues.push(notAnObject(loc));
		return;
	}
	text(event.name, [...loc, 'name'], issues, { required: true, min: 1, max: MOST_NAME });
	byExternalId(event, loc, issues);

	if (
		event.timestamp !== undefined &&
		(typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp)))
	) {
		issues.push({
			loc: [...loc, 'timestamp'],
			msg: 'Input should be a valid datetime',
			type: 'datetime_parsing'
		});
	}
	if (
		event.external_id !== undefined &&
		event.external_id !== null &&
		typeof event.external_id !== 'string'
	) {
		issues.push({
			loc: [...loc, 'external_id'],
			msg: 'Input should be a valid string',
			type: 'string_type'
		});
	}

	const metadata = event.metadata;
	if (metadata === undefined) return;
	if (!isObject(metadata)) {
		issues.push({
			loc: [...loc, 'metadata'],
			msg: 'Input should be a valid dictionary',
			type: 'dict_type'
		});
		return;
	}
	const keys = Object.keys(metadata);
	if (keys.length > MOST_METADATA_KEYS) {
		issues.push({
			loc: [...loc, 'metadata'],
			msg: `Dictionary should have at most ${MOST_METADATA_KEYS} items, not ${keys.length}`,
			type: 'too_long'
		});
	}
	for (const key of keys) {
		const at = [...loc, 'metadata', key];
		if (key.length > MOST_METADATA_KEY) {
			issues.push({
				loc: at,
				msg: `A key may have at most ${MOST_METADATA_KEY} characters`,
				type: 'string_too_long'
			});
		}
		if (RESERVED_METADATA.includes(key)) continue;
		const value = metadata[key];
		if (typeof value === 'string') {
			if (value.length < 1 || value.length > MOST_METADATA_VALUE) {
				issues.push({
					loc: at,
					msg: `A string value must have 1 to ${MOST_METADATA_VALUE} characters`,
					type: value.length < 1 ? 'string_too_short' : 'string_too_long'
				});
			}
		} else if (
			!(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
		) {
			issues.push({
				loc: at,
				msg: 'A value must be a string, a finite number or a boolean',
				type: 'value_error'
			});
		}
	}
}

/**
 * The `external_customer_id` a body names its customer by. Polar takes `customer_id`, its own id,
 * instead; the app never sends one, and this mock refuses it rather than guess at the customer.
 *
 * @param {Record<string, unknown>} body
 * @param {(string | number)[]} loc
 * @param {Issue[]} issues
 */
function byExternalId(body, loc, issues) {
	if (body.external_customer_id === undefined && body.customer_id !== undefined) {
		issues.push({
			loc: [...loc, 'external_customer_id'],
			msg: 'This mock knows customers by external_customer_id only, not by customer_id.',
			type: 'missing'
		});
		return undefined;
	}
	return text(body.external_customer_id, [...loc, 'external_customer_id'], issues, {
		required: true,
		min: 1
	});
}

/**
 * A string field, checked: absent and null are the same, as they are to Polar.
 *
 * @param {unknown} value
 * @param {(string | number)[]} loc
 * @param {Issue[]} issues
 * @param {{ required?: boolean, min?: number, max?: number }} [rules]
 * @returns {string | undefined}
 */
function text(value, loc, issues, { required = false, min = 0, max = Infinity } = {}) {
	if (value === undefined || value === null) {
		if (required) issues.push({ loc, msg: 'Field required', type: 'missing' });
		return undefined;
	}
	if (typeof value !== 'string') {
		issues.push({ loc, msg: 'Input should be a valid string', type: 'string_type' });
		return undefined;
	}
	if (value.length < min) {
		issues.push({
			loc,
			msg: `String should have at least ${min} character${min === 1 ? '' : 's'}`,
			type: 'string_too_short'
		});
		return undefined;
	}
	if (value.length > max) {
		issues.push({
			loc,
			msg: `String should have at most ${max} characters`,
			type: 'string_too_long'
		});
		return undefined;
	}
	return value;
}

/**
 * An address field, which must be http or https, since a browser is sent to it.
 *
 * @param {unknown} value
 * @param {(string | number)[]} loc
 * @param {Issue[]} issues
 * @param {boolean} required
 */
function address(value, loc, issues, required) {
	const given = text(value, loc, issues, { required });
	if (given === undefined) return undefined;
	if (!httpUrl(given)) {
		issues.push({ loc, msg: 'Input should be a valid URL', type: 'url_parsing' });
		return undefined;
	}
	return given;
}

/** @param {string} value */
function httpUrl(value) {
	if (!URL.canParse(value)) return false;
	const { protocol } = new URL(value);
	return protocol === 'http:' || protocol === 'https:';
}

/** @param {(string | number)[]} loc @returns {Issue} */
function notAnObject(loc) {
	return {
		loc,
		msg: 'Input should be a valid dictionary or object to extract fields from',
		type: 'model_attributes_type'
	};
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is Action}
 */
function isAction(value) {
	return ACTIONS.includes(/** @type {Action} */ (value));
}

/** @param {import('node:http').IncomingMessage} request */
function authorised(request) {
	return request.headers.authorization === `Bearer ${TOKEN}`;
}

/**
 * The origin the request was made to, for the addresses a browser is to be sent to.
 *
 * @param {import('node:http').IncomingMessage} request
 */
function originOf(request) {
	const host = request.headers.host ?? '';
	const url = `http://${host}`;
	return host && URL.canParse(url) ? new URL(url).origin : null;
}

/**
 * A month on from a time, by the calendar in UTC, as Polar bills: the 31st of January is followed
 * by the last day of February.
 *
 * @param {number} time
 */
function addMonth(time) {
	const date = new Date(time);
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + 1);
	const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(day, last));
	return date.getTime();
}

/** @param {number} time */
function iso(time) {
	return new Date(time).toISOString();
}

/** @param {number} time A date as the pages show it. */
function day(time) {
	return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** @param {number} cents */
function money(cents) {
	return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The body of a request as JSON, or undefined once the request has been answered: 413 if it is
 * more than `most` bytes, 422 if it is not JSON. A declared length is trusted only to refuse
 * early. The bytes are counted as well, because a body sent in chunks declares none.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {number} most
 * @returns {Promise<unknown>}
 */
async function readJson(request, response, most) {
	const content = await readBody(request, most);
	if (content === null) {
		// The connection is closed, because the rest of the body has been left unread.
		response.setHeader('connection', 'close');
		fail(response, 413, 'PayloadTooLarge', `The body may be at most ${most} bytes.`);
		return undefined;
	}
	try {
		return JSON.parse(content);
	} catch {
		invalid(response, [{ loc: ['body'], msg: 'JSON decode error', type: 'json_invalid' }]);
		return undefined;
	}
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {number} most
 * @returns {Promise<string | null>}
 */
function readBody(request, most) {
	if (Number(request.headers['content-length']) > most) return Promise.resolve(null);

	return new Promise((resolve, reject) => {
		/** @type {Buffer[]} */
		const chunks = [];
		let size = 0;

		request.on('data', (/** @type {Buffer} */ chunk) => {
			size += chunk.length;
			if (size > most) {
				// Stopped, and not destroyed: destroying the request would take the connection with it
				// before the refusal could be sent.
				request.removeAllListeners('data');
				request.pause();
				chunks.length = 0;
				resolve(null);
			} else {
				chunks.push(chunk);
			}
		});
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function json(response, status, body, headers = {}) {
	response
		.writeHead(status, {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			...headers
		})
		.end(JSON.stringify(body));
}

/**
 * An error in the shape Polar gives them.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} error
 * @param {string} detail
 * @param {Record<string, string>} [headers]
 */
function fail(response, status, error, detail, headers) {
	json(response, status, { error, detail }, headers);
}

/**
 * A refused body, in the shape Polar's validation gives: every fault found, each with where it is.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {Issue[]} issues
 */
function invalid(response, issues) {
	json(response, 422, { detail: issues });
}

/** @param {import('node:http').ServerResponse} response */
function unauthorised(response) {
	fail(response, 401, 'Unauthorized', 'A bearer token is required, and must be the mock’s own.');
}

/** @param {import('node:http').ServerResponse} response */
function notFound(response) {
	fail(response, 404, 'ResourceNotFound', 'There is nothing at this address.');
}

/**
 * Whether the request uses the one method the address answers to. If not, it has been answered.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} allow
 */
function only(request, response, allow) {
	if (request.method === allow) return true;
	fail(response, 405, 'MethodNotAllowed', `Only ${allow} is allowed here.`, { allow });
	return false;
}

/**
 * A redirect after a form, which a browser follows with a GET.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {string} location
 */
function redirect(response, location) {
	// Through URL, which percent-encodes what a header cannot carry. A relative address is this
	// server's own.
	const href = URL.canParse(location) ? new URL(location).href : location;
	response.writeHead(303, { location: href, 'cache-control': 'no-store' }).end();
}

/** Markup that has been escaped already, and is put into more markup as it stands. */
class Html {
	/** @param {string} markup */
	constructor(markup) {
		this.markup = markup;
	}
}

/**
 * Markup with everything put into it escaped, unless it is markup itself. A page can only be
 * written with this, so nothing reaches one without passing through it.
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
function html(strings, ...values) {
	/** @param {unknown} value @returns {string} */
	const markup = (value) => {
		if (value instanceof Html) return value.markup;
		if (Array.isArray(value)) return value.map(markup).join('');
		return String(value).replace(
			/[&<>"']/g,
			(character) => `&#${/** @type {number} */ (character.codePointAt(0))};`
		);
	};
	return new Html(strings.reduce((out, string, index) => out + markup(values[index - 1]) + string));
}

/**
 * A button that posts an empty form: the pages work without JavaScript.
 *
 * @param {string} action
 * @param {string} label
 */
function button(action, label) {
	return html`<form method="post" action="${action}" style="display: inline-block; margin: 0 0.5rem 0.5rem 0"><button type="submit">${label}</button></form>`;
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} title
 * @param {Html} body
 */
function page(response, status, title, body) {
	response
		.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
		.end(
			html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Mock Polar</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1>${title}</h1>
${body}
</body>
</html>
`.markup
		);
}

/** @param {import('node:http').ServerResponse} response */
function missingPage(response) {
	page(
		response,
		404,
		'Not found',
		html`<p>There is no checkout or portal at this address, or it has expired.</p>`
	);
}

// Run directly, and not imported by the app's worker or a test.
if (import.meta.main) {
	const port = Number(process.env.PORT ?? 4100);
	const server = createMockPolar();

	// The loopback address only: nothing else on the network has any business with it.
	server.listen(port, '127.0.0.1', () => {
		console.log(`mock-polar: listening on http://127.0.0.1:${port}`);
	});

	// A server that is only closed waits for every connection kept alive, so those are cut too.
	for (const signal of ['SIGTERM', 'SIGINT']) {
		process.once(signal, () => {
			server.close();
			server.closeAllConnections();
		});
	}
}
