// Two things `saveAction` promises that nothing on a page would show to be broken: that a secret
// is never sent back, and that an action which says its answer cannot be given from memory is
// acted on every time. Both are checked against every way an action can end.

import { error, type RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { SEND_KEY } from '../send-key.js';

// The log reads LOG_LEVEL from the environment, which a test has none of. Errors only: a fault is
// recorded on purpose below, and the refusals around it would only be noise.
vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { refuse, saveAction } = await import('./save-action.js');

const PASSWORD = 'correct horse battery staple';

/** A form posted to `?/name`, as an action is handed it. */
function posted(name: string, fields: Record<string, string>): RequestEvent {
	const url = new URL(`http://localhost/page?/${name}`);
	const body = new FormData();
	for (const [field, value] of Object.entries(fields)) body.set(field, value);

	return {
		url,
		request: new Request(url, { method: 'POST', body }),
		route: { id: '/page' },
		getClientAddress: () => '127.0.0.1'
	} as unknown as RequestEvent;
}

describe('a secret field', () => {
	const SignIn = z.object({
		email: z.email('That is not an email address.'),
		password: z.string().min(1, 'Enter your password.')
	});
	const fields = { email: 'ada@example.com', password: PASSWORD };

	/** The refusal an action gives the fields above, when it ends the way `save` does. */
	async function refusal(save: () => void, sent = fields, text?: number) {
		const action = saveAction('signIn', SignIn, save, { secret: ['password'], text });
		const answer = await action(posted('signIn', sent));
		if (!answer || !('status' in answer)) throw new Error('The action saved, and should not have.');
		return answer;
	}

	const endings: [how: string, status: number, answer: () => ReturnType<typeof refusal>][] = [
		[
			'the schema turns a field down',
			400,
			() => refusal(() => {}, { email: 'not an address', password: PASSWORD })
		],
		['the action turns a field down', 400, () => refusal(() => refuse({ password: 'Wrong.' }))],
		['the action turns the form down', 401, () => refusal(() => error(401, 'Not signed in.'))],
		[
			'the action breaks',
			500,
			async () => {
				// A fault is recorded as an error, which is what it is. Not on the test's output.
				const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
				try {
					return await refusal(() => {
						throw new Error('The database is on fire.');
					});
				} finally {
					quiet.mockRestore();
				}
			}
		],
		['a field is over its limit', 400, () => refusal(() => {}, fields, 5)]
	];

	for (const [how, status, answer] of endings) {
		it(`is not sent back when ${how}`, async () => {
			const refused = await answer();

			expect(refused.status).toBe(status);
			expect(refused.data.values.password).toBe('');
			// Nowhere in the answer, under any name.
			expect(JSON.stringify(refused)).not.toContain(PASSWORD);
		});
	}

	it('leaves the other fields as they were typed', async () => {
		const refused = await refusal(() => refuse({ password: 'Wrong.' }));
		expect(refused.data.values.email).toBe('ada@example.com');
	});

	it('is still handed to the action', async () => {
		let given: string | undefined;
		const action = saveAction('signIn', SignIn, (values) => void (given = values.password), {
			secret: ['password']
		});
		await action(posted('signIn', fields));
		expect(given).toBe(PASSWORD);
	});

	it('is sent back like any other field by an action that does not name it', async () => {
		const action = saveAction('signIn', SignIn, () => refuse({ password: 'Wrong.' }));
		// Not the fields the test above saved with: sent again inside a second, to the same
		// address, they would be taken for a repeat of that press and answered from memory.
		const answer = await action(posted('signIn', { ...fields, email: 'grace@example.com' }));
		expect(JSON.stringify(answer)).toContain(PASSWORD);
	});
});

describe('a repeat of one press', () => {
	const Name = z.object({ name: z.string() });
	// The same press twice: the same fields under the same key.
	const press = (name: string, key: string) => posted(name, { name: 'Ada', [SEND_KEY]: key });

	it('is answered from memory, and the action is not run again', async () => {
		let runs = 0;
		const action = saveAction('rename', Name, () => ({ run: (runs += 1) }));

		expect(await action(press('rename', 'key-one'))).toEqual({ run: 1 });
		expect(await action(press('rename', 'key-one'))).toEqual({ run: 1 });
		expect(runs).toBe(1);
	});

	it('is acted on again by an action that says not to remember', async () => {
		let runs = 0;
		const action = saveAction('signIn', Name, () => ({ run: (runs += 1) }), { remember: false });

		expect(await action(press('signIn', 'key-two'))).toEqual({ run: 1 });
		expect(await action(press('signIn', 'key-two'))).toEqual({ run: 2 });
		expect(runs).toBe(2);
	});

	it('is still answered from memory for the actions beside one that is not', async () => {
		let remembered = 0;
		let fresh = 0;
		const rename = saveAction('rename', Name, () => ({ run: (remembered += 1) }));
		const signIn = saveAction('signIn', Name, () => ({ run: (fresh += 1) }), { remember: false });

		// Interleaved, as two forms on one page would be.
		await rename(press('rename', 'key-three'));
		await signIn(press('signIn', 'key-three'));
		await rename(press('rename', 'key-three'));
		await signIn(press('signIn', 'key-three'));

		expect(remembered).toBe(1);
		expect(fresh).toBe(2);
	});
});
