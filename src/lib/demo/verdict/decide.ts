/**
 * The questions on the Verdict page, and the rule that turns answers into a recommendation.
 *
 * Each option carries a weight and the reason for it. The weights are judgements, not
 * measurements; they are written out here so that anyone who disagrees can see exactly where.
 */
export interface Option {
	value: string;
	label: string;
	/** Positive counts for adopting SvelteKit, negative against. */
	weight: number;
	/** Shown to the reader when this option moved the result. Omitted for neutral options. */
	reason?: string;
	/** Decides the answer on its own, whatever else was chosen. */
	veto?: boolean;
}

export interface Question {
	id: string;
	prompt: string;
	options: Option[];
}

export const questions: Question[] = [
	{
		id: 'building',
		prompt: 'What are you building?',
		options: [
			{
				value: 'content',
				label: 'A content-led site: marketing, documentation, a blog',
				weight: 2,
				reason:
					'Content sites are where it is strongest. Pages can be prerendered or server-rendered and ship little or no JavaScript.'
			},
			{
				value: 'product',
				label: 'A web product with public pages and an application behind them',
				weight: 2,
				reason:
					'One codebase can serve fast public pages and a full application, choosing how each route is rendered.'
			},
			{
				value: 'internal',
				label: 'An internal tool or dashboard',
				weight: 1,
				reason:
					'Internal tools gain less from server rendering, but lose nothing: the same code runs client-only.'
			},
			{
				value: 'native',
				label: 'Web and native mobile apps that share one interface codebase',
				weight: -3,
				veto: true,
				reason:
					'Svelte has no counterpart to React Native that is as mature. If sharing interface code with native apps is a requirement, that decides the question.'
			}
		]
	},
	{
		id: 'team',
		prompt: 'What does your team know today?',
		options: [
			{
				value: 'react',
				label: 'Deep React experience, and a lot of existing React code',
				weight: -1,
				reason:
					'A team invested in React pays a real switching cost: retraining, and components that cannot be carried over.'
			},
			{
				value: 'mixed',
				label: 'A mixture, with no strong attachment',
				weight: 1,
				reason:
					'With no strong attachment elsewhere there is little to unlearn. Svelte stays close to plain HTML, CSS and JavaScript.'
			},
			{
				value: 'svelte',
				label: 'Some Svelte already, or a small team that learns quickly',
				weight: 2,
				reason: 'Your team already knows it, or can learn it quickly. The largest cost is paid.'
			}
		]
	},
	{
		id: 'ecosystem',
		prompt: 'How much do you rely on ready-made components and vendor SDKs?',
		options: [
			{
				value: 'heavily',
				label: 'Heavily. We assemble products from existing component kits',
				weight: -2,
				reason:
					'Most component kits and vendor SDKs are built for React first. Expect fewer ready-made choices and more wrappers written by you.'
			},
			{
				value: 'somewhat',
				label: 'Somewhat. A few key libraries',
				weight: 0
			},
			{
				value: 'rarely',
				label: 'Rarely. We build our own interface',
				weight: 2,
				reason: 'You build your own interface, so the smaller component ecosystem costs you little.'
			}
		]
	},
	{
		id: 'performance',
		prompt: 'How much do first-load speed and search visibility matter?',
		options: [
			{
				value: 'critical',
				label: 'They are critical to the business',
				weight: 2,
				reason:
					'First-load speed and search visibility are where server rendering and small bundles pay off most.'
			},
			{
				value: 'helpful',
				label: 'They help, but are not decisive',
				weight: 1,
				reason: 'Faster first loads are a benefit you would get without having to work for it.'
			},
			{
				value: 'irrelevant',
				label: 'Hardly at all. Everything is behind a login',
				weight: 0
			}
		]
	},
	{
		id: 'hiring',
		prompt: 'How will the team grow?',
		options: [
			{
				value: 'fast',
				label: 'We need to hire many developers quickly',
				weight: -2,
				reason:
					'Far fewer developers have Svelte experience than React. Hiring quickly would mean training people, not finding them.'
			},
			{
				value: 'steady',
				label: 'Slowly, or not at all',
				weight: 1,
				reason: 'A stable team learns the framework once.'
			}
		]
	},
	{
		id: 'upgrades',
		prompt: 'How do you feel about framework upgrades?',
		options: [
			{
				value: 'averse',
				label: 'We need APIs that stay put for years',
				weight: -1,
				reason:
					'Svelte 5 and SvelteKit 3 both made breaking changes. Expect to spend time on upgrades.'
			},
			{
				value: 'routine',
				label: 'We keep dependencies current as a matter of routine',
				weight: 1,
				reason:
					'You already budget for upgrades, so a framework that is still moving is manageable.'
			}
		]
	}
];

export type Answers = Record<string, string>;

export type Outcome = 'yes' | 'cautious' | 'no';

export interface Verdict {
	outcome: Outcome;
	score: number;
	reasonsFor: string[];
	reasonsAgainst: string[];
}

/** At or above this score the answer is a plain yes; below `CAUTIOUS_FROM` it is a no. */
const YES_FROM = 6;
const CAUTIOUS_FROM = 2;

/** Keeps only answers that name a real question and one of its real options. */
export function readAnswers(params: URLSearchParams): Answers {
	const answers: Answers = {};
	for (const question of questions) {
		const value = params.get(question.id);
		if (question.options.some((option) => option.value === value)) answers[question.id] = value!;
	}
	return answers;
}

/** The recommendation for a set of answers, or `undefined` until every question is answered. */
export function decide(answers: Answers): Verdict | undefined {
	const chosen: Option[] = [];
	for (const question of questions) {
		const option = question.options.find((candidate) => candidate.value === answers[question.id]);
		if (!option) return undefined;
		chosen.push(option);
	}

	const score = chosen.reduce((total, option) => total + option.weight, 0);
	const reasons = (keep: (option: Option) => boolean) =>
		chosen.filter((option) => option.reason && keep(option)).map((option) => option.reason!);

	let outcome: Outcome = score >= YES_FROM ? 'yes' : score >= CAUTIOUS_FROM ? 'cautious' : 'no';
	if (chosen.some((option) => option.veto)) outcome = 'no';

	return {
		outcome,
		score,
		reasonsFor: reasons((option) => option.weight > 0),
		reasonsAgainst: reasons((option) => option.weight < 0)
	};
}
