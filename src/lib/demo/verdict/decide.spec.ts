import { describe, expect, it } from 'vitest';
import { decide, questions, readAnswers, type Answers } from './decide.js';

/** The option of each question that argues most strongly in the given direction. */
function extreme(direction: 'for' | 'against'): Answers {
	return Object.fromEntries(
		questions.map((question) => {
			const candidates = question.options.filter((option) => !option.veto);
			const best = candidates.reduce((a, b) =>
				(direction === 'for' ? b.weight > a.weight : b.weight < a.weight) ? b : a
			);
			return [question.id, best.value];
		})
	);
}

describe('decide', () => {
	it('gives no verdict until every question is answered', () => {
		const answers = extreme('for');
		delete answers[questions[0].id];

		expect(decide({})).toBeUndefined();
		expect(decide(answers)).toBeUndefined();
	});

	it('says yes when everything argues for it', () => {
		const verdict = decide(extreme('for'));

		expect(verdict?.outcome).toBe('yes');
		expect(verdict?.reasonsAgainst).toEqual([]);
		expect(verdict?.reasonsFor.length).toBeGreaterThan(0);
	});

	it('says no when everything argues against it', () => {
		const verdict = decide(extreme('against'));

		expect(verdict?.outcome).toBe('no');
		expect(verdict?.reasonsAgainst.length).toBeGreaterThan(0);
	});

	it('is cautious for a good fit with real costs', () => {
		const verdict = decide({
			building: 'product',
			team: 'react',
			ecosystem: 'somewhat',
			performance: 'critical',
			hiring: 'fast',
			upgrades: 'routine'
		});

		expect(verdict?.outcome).toBe('cautious');
		expect(verdict?.reasonsFor.length).toBeGreaterThan(0);
		expect(verdict?.reasonsAgainst.length).toBeGreaterThan(0);
	});

	// The honest answer for a team that must share interface code with native apps is no, however
	// well everything else fits.
	it('lets a veto decide the answer on its own', () => {
		const verdict = decide({ ...extreme('for'), building: 'native' });

		expect(verdict?.outcome).toBe('no');
	});

	it('can reach every outcome, so the page is not a foregone conclusion', () => {
		const outcomes = new Set<string>();
		const walk = (index: number, answers: Answers) => {
			if (index === questions.length) {
				outcomes.add(decide(answers)!.outcome);
				return;
			}
			for (const option of questions[index].options) {
				walk(index + 1, { ...answers, [questions[index].id]: option.value });
			}
		};
		walk(0, {});

		expect([...outcomes].sort()).toEqual(['cautious', 'no', 'yes']);
	});
});

describe('readAnswers', () => {
	it('keeps valid answers and drops everything else', () => {
		const params = new URLSearchParams({
			building: 'product',
			team: 'not-an-option',
			unknown: 'value'
		});

		expect(readAnswers(params)).toEqual({ building: 'product' });
	});
});
