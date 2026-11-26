/**
 * The emails the accounts send, as plain text: what each says, and nothing about how it is sent
 * (that is ../mail.ts). Each is short, says what was asked for and by whom it could have been,
 * and puts its link on a line of its own, where every mail client makes it a link.
 *
 * None of them waits for the mail server: see `send`.
 */
import { send } from '../mail.js';

const SIGNATURE = 'Team Collaborator';

/** A message's paragraphs as its text, with the signature under them. */
const body = (...paragraphs: string[]) => [...paragraphs, SIGNATURE].join('\n\n');

/** To a new address, on sign-up, on a sign-in that was not verified, and at the end of a change of address. */
export function verifyEmail(to: string, url: string): void {
	send({
		kind: 'verify-email',
		to,
		subject: 'Confirm your email address',
		text: body(
			'Open this link to confirm that this address is yours. It signs you in.',
			url,
			'The link works for one hour. If you did not ask for it, ignore this message: nothing happens unless the link is opened.'
		)
	});
}

/**
 * To an address that already has an account, when somebody signs up with it again. The page
 * that took the sign-up says the same thing either way, so that it cannot be used to find out
 * who has an account. The owner of the address is told here instead.
 */
export function alreadyRegistered(to: string, signInUrl: string): void {
	send({
		kind: 'already-registered',
		to,
		subject: 'You already have an account',
		text: body(
			'Somebody, perhaps you, tried to create a Team Collaborator account with this address. There already is one, so nothing was changed.',
			`To sign in, or to choose a new password if you have forgotten yours:\n${signInUrl}`,
			'If it was not you, there is nothing you need to do.'
		)
	});
}

/** To an account's address, when a new password is asked for. It also gives a password to an account that has none. */
export function resetPassword(to: string, url: string): void {
	send({
		kind: 'reset-password',
		to,
		subject: 'Choose a new password',
		text: body(
			'Open this link to choose a new password for your Team Collaborator account.',
			url,
			'The link works for one hour, and once. Choosing a new password signs the account out everywhere else. If you did not ask for this, ignore this message: your password stays as it is.'
		)
	});
}

/** To the address an account has now, before it is changed: the change needs its say-so. */
export function confirmEmailChange(to: string, newEmail: string, url: string): void {
	send({
		kind: 'confirm-email-change',
		to,
		subject: 'Confirm your new email address',
		text: body(
			`You asked to change the address of your Team Collaborator account to ${newEmail}. Open this link to go ahead.`,
			url,
			'A second link is then sent to the new address, and the change is made when that one is opened. If you did not ask for this, ignore this message and change your password: somebody is signed in to your account.'
		)
	});
}

/** To an account's address, when its owner asks to delete it. */
export function confirmDeletion(to: string, url: string): void {
	send({
		kind: 'confirm-deletion',
		to,
		subject: 'Delete your account',
		text: body(
			'You asked to delete your Team Collaborator account. Open this link, in the browser you are signed in with, to see the last step.',
			url,
			'The link works for one day. Deleting cannot be undone. If you did not ask for this, ignore this message and change your password: somebody is signed in to your account.'
		)
	});
}
