// Shipping is how what a customer used becomes what Polar bills them for. Broken, use is never
// sent and never charged for, or sent over and over, or one event Polar will not take holds up
// everybody's usage behind it for good. Polar is a hand-written fake here, so that what it is
// sent, and what it says back, are exactly what each test decides; the ledger is a real table.

import { PolarClientError } from '@polar-sh/sdk';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usageEvent } from '../../db/billing-schema.js';
import { reachServices } from '../testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { shipOnce } = await import('./ship.js');

const services = await reachServices(10);
afterAll(async () => services?.close());
afterEach(() => vi.restoreAllMocks());

const PERIOD = new Date('2026-11-01T00:00:00Z');
const START = Date.parse('2026-11-10T12:00:00Z');

describe.skipIf(!services)('sending usage to Polar', () => {
	const { db } = services!;

	let sent: string[][];
	let takes: number;
	const budget = {
		take: async () => {
			takes++;
		},
		pause() {}
	};
	/** What Polar answers with, for a batch it has been sent. */
	let answer: (ids: string[]) => { inserted: number; duplicates: number };
	const polar = {
		async ingest(events: { id: string }[]) {
			const ids = events.map((event) => event.id);
			sent.push(ids);
			return answer(ids);
		}
	};
	const ship = () => shipOnce({ db, polar: polar as never, budget });

	beforeEach(async () => {
		sent = [];
		takes = 0;
		answer = (ids) => ({ inserted: ids.length, duplicates: 0 });
		await db.delete(usageEvent);
	});

	/** A row in the ledger, `minutes` after the first. Its id says which it is. */
	async function row(
		name: string,
		minutes: number,
		fields: Partial<typeof usageEvent.$inferInsert> = {}
	) {
		await db.insert(usageEvent).values({
			id: `00000000-0000-4000-8000-${name.padStart(12, '0')}`,
			recordedAt: new Date(START + minutes * 60_000),
			subjectId: `subject-${name}`,
			meter: 'api_calls',
			periodStart: PERIOD,
			units: 1,
			...fields
		});
		return `00000000-0000-4000-8000-${name.padStart(12, '0')}`;
	}

	const stored = async () =>
		Object.fromEntries((await db.select().from(usageEvent)).map((each) => [each.id, each]));

	it('sends the rows oldest first in one request, and marks each as sent', async () => {
		const third = await row('3', 3);
		const first = await row('1', 1);
		const second = await row('2', 2);

		expect(await ship()).toBe(3);

		expect(sent).toEqual([[first, second, third]]);
		const rows = await stored();
		for (const id of [first, second, third]) {
			expect(rows[id].shippedAt).toBeInstanceOf(Date);
			expect(rows[id].shipError).toBeNull();
		}
	});

	it('sends the event as the ledger has it', async () => {
		const events: unknown[] = [];
		const id = await row('1', 1, { units: 9, subjectId: 'person' });

		await shipOnce({
			db,
			polar: {
				async ingest(batch: unknown[]) {
					events.push(...batch);
					return { inserted: 1, duplicates: 0 };
				}
			},
			budget
		});

		expect(events).toEqual([
			{
				id,
				subjectId: 'person',
				meter: 'api_calls',
				units: 9,
				recordedAt: new Date(START + 60_000)
			}
		]);
	});

	it('asks the budget before each request', async () => {
		await row('1', 1);

		await ship();

		expect(takes).toBe(1);
	});

	it('does not touch a row that has been sent, or one that was set aside', async () => {
		await row('1', 1, { shippedAt: new Date() });
		await row('2', 2, { shipError: 'refused' });
		const waiting = await row('3', 3);

		expect(await ship()).toBe(1);

		expect(sent).toEqual([[waiting]]);
	});

	it('answers 0 and makes no call when there is nothing to send', async () => {
		expect(await ship()).toBe(0);

		expect(sent).toEqual([]);
		expect(takes).toBe(0);
	});

	describe('when Polar cannot be reached or says to wait', () => {
		it.each([
			['an error that is not Polar refusing the event', new Error('network down')],
			['a client error that is not a 422', new PolarClientError(404, {})],
			['a rate limit', new PolarClientError(429, {})]
		])('leaves every row unsent and rethrows for %s', async (_, failure) => {
			const ids = [await row('1', 1), await row('2', 2)];
			answer = () => {
				throw failure;
			};

			await expect(ship()).rejects.toBe(failure);

			const rows = await stored();
			for (const id of ids) {
				expect(rows[id].shippedAt).toBeNull();
				expect(rows[id].shipError).toBeNull();
			}
			// Not cut into halves: the same request is simply made again on the next pass.
			expect(sent).toEqual([ids]);
		});
	});

	describe('when Polar refuses a batch as invalid', () => {
		it('narrows it by halves to the one bad event, which is set aside while all the rest are sent', async () => {
			const ids: string[] = [];
			for (let i = 0; i < 8; i++) ids.push(await row(String(i), i));
			const bad = ids[4];
			answer = (batch) => {
				if (batch.includes(bad)) throw new PolarClientError(422, {});
				return { inserted: batch.length, duplicates: 0 };
			};
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await ship()).toBe(8);

			// The whole batch, then each half, narrowing on the half that holds the bad one.
			expect(sent).toEqual([
				ids,
				ids.slice(0, 4),
				ids.slice(4),
				ids.slice(4, 6),
				[ids[4]],
				[ids[5]],
				ids.slice(6)
			]);
			expect(takes).toBe(sent.length);

			const rows = await stored();
			expect(rows[bad].shippedAt).toBeNull();
			expect(rows[bad].shipError).toBe('Polar refused the event as invalid.');
			for (const id of ids.filter((each) => each !== bad)) {
				expect(rows[id].shippedAt).toBeInstanceOf(Date);
				expect(rows[id].shipError).toBeNull();
			}
			expect(String(error.mock.calls[0][0])).toContain('billing usage refused');
		});

		it('sets aside a lone event that is refused, and does not send it again on the next pass', async () => {
			const only = await row('1', 1);
			answer = () => {
				throw new PolarClientError(422, {});
			};
			vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await ship()).toBe(1);
			expect(await ship()).toBe(0);

			expect(sent).toEqual([[only]]);
			expect((await stored())[only].shipError).not.toBeNull();
		});
	});

	describe('a row for a meter that is not in the catalogue', () => {
		it('is set aside and never sent, and the others go', async () => {
			const odd = await row('1', 1, { meter: 'storage' });
			const fine = await row('2', 2);
			vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await ship()).toBe(2);

			expect(sent).toEqual([[fine]]);
			const rows = await stored();
			expect(rows[odd].shipError).toBe('The meter is not in the catalogue.');
			expect(rows[odd].shippedAt).toBeNull();
			expect(rows[fine].shippedAt).toBeInstanceOf(Date);
		});

		it('is set aside without a call when it is all there is', async () => {
			await row('1', 1, { meter: 'storage' });
			vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await ship()).toBe(1);

			expect(sent).toEqual([]);
			expect(takes).toBe(0);
		});
	});

	describe("when Polar's count is not the number sent", () => {
		it('records it as an error, and still marks the rows as sent', async () => {
			const ids = [await row('1', 1), await row('2', 2)];
			answer = () => ({ inserted: 1, duplicates: 0 });
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await ship()).toBe(2);

			expect(String(error.mock.calls[0][0])).toContain('billing ingest count mismatch');
			const rows = await stored();
			for (const id of ids) expect(rows[id].shippedAt).toBeInstanceOf(Date);
		});

		it('says nothing when the inserted and the duplicates add up to what was sent', async () => {
			await row('1', 1);
			await row('2', 2);
			answer = () => ({ inserted: 1, duplicates: 1 });
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			await ship();

			expect(error).not.toHaveBeenCalled();
		});
	});
});
