/**
 * Takes a webhook from Polar: checks that Polar sent it, notes who it is about, and is done.
 *
 * Nothing in the webhook is acted on. Polar promises neither that one arrives once nor that two
 * arrive in the order things happened, so a payload cannot be trusted to be the latest word. What
 * it can be trusted for is that something about a customer changed. So the customer's row is
 * marked, in one statement, and the worker asks Polar what is true now (./worker/sync.ts). The
 * mark is the whole of what is kept: a second delivery of the same webhook marks the row again,
 * and costs one more question.
 *
 * That makes this quick, which Polar needs. It waits ten seconds for an answer, asks for one
 * within two, and stops sending to an address that keeps failing.
 */
import { webhooks } from '@polar-sh/sdk/2026-10';
import { sql } from 'drizzle-orm';
import { record } from '#lib/server/log.js';
import type { Database } from './service.js';

/** What to answer Polar with. Anything from 200 to 299 tells it not to send the webhook again. */
export type Receipt =
	/** Not from Polar, or not as Polar sent it. */
	| { status: 403 }
	/** Taken. `subjectId` is who was marked, or null when it was about nobody this site knows. */
	| { status: 202; subjectId: string | null };

/**
 * Who a webhook is about, by their account's id, which is the customer's `external_id` at Polar.
 * A customer's own events carry it on the customer, and every other kind (a subscription, an
 * order, a grant) carries the customer inside. Null for an event about no customer, such as a
 * product being edited, and for a customer made in Polar by hand, who has no account here.
 */
function subjectOf(event: { type: string; data: unknown }): string | null {
	// An event with nothing in it is about nobody. Polar signed it, so it is taken, and not
	// answered with a failure that Polar would only send again.
	const data = (event.data ?? {}) as {
		external_id?: unknown;
		customer?: { external_id?: unknown } | null;
	};
	const id = event.type.startsWith('customer.') ? data.external_id : data.customer?.external_id;
	return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * @param body The request's body exactly as it arrived. The signature is over those bytes, so it
 *   is checked before anything parses them.
 */
export async function receiveWebhook(
	{ db, secret }: { db: Database; secret: string },
	body: string,
	headers: Headers
): Promise<Receipt> {
	let event: Awaited<ReturnType<typeof webhooks.validateEvent>>;
	try {
		event = await webhooks.validateEvent(body, Object.fromEntries(headers), secret);
	} catch (error) {
		// A kind of event this version of the SDK has no name for. It was Polar that sent it,
		// and sending it again would change nothing, so it is taken and left.
		if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
			record('info', 'billing webhook of an unknown type', { type: error.eventType });
			return { status: 202, subjectId: null };
		}
		if (error instanceof webhooks.PolarWebhookError) {
			record('info', 'billing webhook refused', { reason: error.message });
			return { status: 403 };
		}
		throw error;
	}

	const subjectId = subjectOf(event);
	if (subjectId === null) return { status: 202, subjectId: null };

	// The row is made only for an id that is an account here. Polar may send webhooks about
	// customers this site did not create, and a row for one of those would later be taken for an
	// account that has been deleted, and its customer removed from Polar (./worker/sync.ts).
	const marked = await db.execute(sql`
		insert into billing.state (subject_id, dirty_at)
		select id, now() from "user" where id = ${subjectId}
		on conflict (subject_id) do update set dirty_at = now()
	`);

	record('info', 'billing webhook', {
		type: event.type,
		id: headers.get('webhook-id'),
		subjectId,
		known: marked.rowCount === 1
	});
	return { status: 202, subjectId: marked.rowCount === 1 ? subjectId : null };
}
