/**
 * The accent colours the picker offers, in order round the colour wheel. Orange is the default.
 *
 * Each also needs a rule in src/routes/layout.css (under "Accents") and a place in the list in
 * the boot script in src/app.html. accents.test.ts checks that the three agree.
 */
export const accents = [
	{ value: 'red', label: 'Red' },
	{ value: 'orange', label: 'Orange' },
	{ value: 'amber', label: 'Amber' },
	{ value: 'green', label: 'Green' },
	{ value: 'teal', label: 'Teal' },
	{ value: 'blue', label: 'Blue' },
	{ value: 'purple', label: 'Purple' },
	{ value: 'pink', label: 'Pink' }
] as const;

export const DEFAULT_ACCENT = 'orange';
