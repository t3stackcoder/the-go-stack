// Question: what does a form bound to a Superforms store keep of what a visitor entered before
// the page had hydrated?
//
// One field of every kind, each starting from a value the server chose, so a field that hydration
// set back is plain to see. Under the form the page prints what the store holds. Once the page
// has hydrated the fields and the store should agree, and both should say what was entered.
//
// Its twin, /stress/forms/early-input, binds the same fields to plain state.
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const schema = z.object({
	text: z.string().default('server'),
	count: z.number().default(3),
	notes: z.string().default('server'),
	agree: z.boolean().default(false),
	size: z.enum(['small', 'medium', 'large']).default('medium'),
	extras: z.array(z.enum(['wrap', 'card', 'rush'])).default(['card']),
	colour: z.enum(['red', 'green', 'blue']).default('green'),
	days: z.array(z.enum(['mon', 'tue', 'wed'])).default(['tue'])
});

export const load: PageServerLoad = async () => ({ form: await superValidate(zod4(schema)) });
