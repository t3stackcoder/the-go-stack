/**
 * Email: one transport over SMTP_URL, and one way to send.
 *
 * In development the server is Mailpit (compose.yaml), which keeps every message and delivers
 * none of them: http://localhost:8025.
 */
import { createTransport } from 'nodemailer';
import { describeError } from '#lib/errors.js';
import { record } from '#lib/server/log.js';
import { MAIL_FROM, SMTP_URL } from '$app/env/private';

// Nothing connects until the first message is sent.
const transport = createTransport(SMTP_URL);

export interface Message {
	/** What the message is for, such as `verify-email`. It is what the log knows a failure by. */
	kind: string;
	to: string;
	subject: string;
	/** Plain text. A link on a line of its own is a link in every mail client. */
	text: string;
}

/**
 * Sends a message, and returns at once without waiting for the mail server.
 *
 * Whoever asked for the email is waiting for a page, and how long a mail server takes is not
 * theirs to wait out. Nor may the wait tell them anything: a request for a password reset
 * answers the same whether or not the address has an account, and an answer that took as long
 * as an email takes to hand over would say which.
 *
 * So a failure cannot reach the visitor, and it must not vanish either. It is recorded, as an
 * error, by what kind of message it was. The address is left out of the log, as personal
 * details are everywhere else.
 */
export function send({ kind, to, subject, text }: Message): void {
	transport.sendMail({ from: MAIL_FROM, to, subject, text }).catch((error: unknown) => {
		record('error', 'email not sent', { kind, ...describeError(error) });
	});
}
