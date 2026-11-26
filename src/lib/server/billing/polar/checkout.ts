/**
 * The two calls to Polar that a request may make and wait for: somebody pressed a button to be
 * sent there, to pay or to manage what they pay for. See ./client.ts for why there are only two.
 */
import { createCheckouts } from '@polar-sh/sdk/2026-10/services/checkouts';
import { createCustomerSessions } from '@polar-sh/sdk/2026-10/services/customer_sessions';
import { describeError } from '#lib/errors.js';
import { record } from '#lib/server/log.js';
import type { Catalogue } from '../catalogue.js';
import { isInvalid, isNotFound, type PolarCore } from './client.js';

export function checkoutCalls(core: PolarCore, catalogue: Catalogue) {
	return {
		/**
		 * Starts a checkout for the product and answers with the address of Polar's page for it.
		 *
		 * The person is named by their account's id. Polar keeps that as the customer's
		 * `external_id`, making the customer if this is their first checkout, and every later
		 * call names them the same way. `successUrl` may hold `{CHECKOUT_ID}`, which Polar fills in.
		 */
		async createCheckout(order: {
			subjectId: string;
			email: string;
			name: string | null;
			successUrl: string;
			returnUrl: string;
		}): Promise<string> {
			const checkout = await createCheckouts(core)({
				products: [catalogue.productId],
				external_customer_id: order.subjectId,
				customer_email: order.email,
				customer_name: order.name,
				success_url: order.successUrl,
				return_url: order.returnUrl
			});
			return checkout.url;
		},

		/**
		 * The address of Polar's own pages for a customer, where they see their invoices and
		 * cancel. Null for somebody Polar has no customer for, who has never been through a
		 * checkout and has nothing there to manage.
		 */
		async createPortal(visit: { subjectId: string; returnUrl: string }): Promise<string | null> {
			try {
				const session = await createCustomerSessions(core)({
					external_customer_id: visit.subjectId,
					return_url: visit.returnUrl
				});
				return session.customer_portal_url;
			} catch (error) {
				// Polar's SDK lists no 404 for this call, only a 422, so that is taken to be how it
				// says the customer does not exist. Not checked against the real Polar. The other
				// thing a 422 could mean is a bad return address, and that one is this site's own
				// fault. So a 422 is recorded: taken in silence, a mistake of this site's would
				// tell every customer that they have nothing to manage, and nobody here would know.
				if (isNotFound(error)) return null;
				if (isInvalid(error)) {
					record('error', 'billing portal refused as invalid', describeError(error));
					return null;
				}
				throw error;
			}
		}
	};
}

export type CheckoutCalls = ReturnType<typeof checkoutCalls>;
