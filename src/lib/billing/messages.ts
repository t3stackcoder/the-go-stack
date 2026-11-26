/**
 * Every sentence the billing page's forms can say, in one place, so that each is held to the
 * room the page reserves for it: two lines for a form's status, as on the account pages, and so
 * no more than `FORM_MAX` characters (src/lib/auth/messages.ts says how that was measured).
 * ./messages.test.ts checks every one, the longest numbers included.
 *
 * The sentences about a use say what was counted and what is left in numbers, and not "1 API
 * calls": the meter's name stands beside the form already.
 */
import { count } from './summary.js';

/** Polar could not be reached, or is not set up: an Upgrade or a Manage billing that went nowhere. */
export const UNREACHABLE = 'Billing could not be reached. Nothing was charged. Try again soon.';

/** Manage billing, for somebody Polar has never sold anything to. */
export const NOTHING_TO_MANAGE = 'There is nothing to manage yet: you have not bought anything.';

/** What the meter form says when the use could not be counted, and so was not allowed. */
export const UNCOUNTABLE = 'Not counted, and so not allowed: billing could not be reached.';

/** What the meter form says for a number of units that it does not offer. */
export const UNITS = 'Choose 1, 10 or 100.';

/** What the meter form says about a use that was counted. */
export function counted(units: number, remaining: number | null): string {
	return remaining === null
		? `Counted ${count(units)}. Nothing limits it this period.`
		: `Counted ${count(units)}. ${count(remaining)} left this period.`;
}

/** What the meter form says about a use that was refused, and why. */
export function notCounted(units: number, reason: 'inactive' | 'limit', remaining: number): string {
	if (reason === 'inactive') return 'Not counted: there is no subscription to count it against.';
	return remaining > 0
		? `Not counted: ${count(units)} is more than the ${count(remaining)} left this period.`
		: 'Not counted: the limit for this period has been reached.';
}
