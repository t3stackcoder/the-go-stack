/**
 * What the server and the browser share when something fails unexpectedly: the words shown to the
 * visitor, the reference they are given, and the description that is recorded.
 */

/**
 * Shown in place of an unexpected error's own message, which is written for developers and can
 * carry details that should not leave the server.
 */
export const UNEXPECTED = 'Something went wrong on our side. It has been recorded.';

/**
 * A short random reference, shown to the visitor and written beside the recorded error, so that a
 * report from one leads to the other. `crypto.randomUUID` would do, but browsers only provide it
 * on secure origins, and an error hook must not be the thing that throws.
 */
export function errorReference(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The parts of a thrown value worth recording. Anything can be thrown, not only an Error. */
export function describeError(error: unknown): { name: string; message: string; stack?: string } {
	if (error instanceof Error) {
		return { name: error.name, message: error.message, stack: error.stack };
	}
	return { name: typeof error, message: String(error) };
}
