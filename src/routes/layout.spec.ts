import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the contrast of the colour tokens in layout.css, in both themes. The tokens are read
 * from the stylesheet itself, so changing a colour there is all it takes to be checked.
 *
 * WCAG asks for 4.5:1 between normal-sized text and its background (level AA) and 7:1 for level
 * AAA, which the primary text colour is held to.
 */

type Theme = 'light' | 'dark';

/** Every `--color-*` token: its OKLCH lightness, chroma and hue in each theme. */
const tokens = new Map<string, Record<Theme, [number, number, number]>>();

const css = readFileSync(new URL('./layout.css', import.meta.url), 'utf8');
const oklch = String.raw`oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)`;
const declaration = new RegExp(
	String.raw`--color-([\w-]+): (?:light-dark\(${oklch}, ${oklch}\)|${oklch});`,
	'g'
);
for (const [, name, ...values] of css.matchAll(declaration)) {
	const numbers = values.filter((value) => value !== undefined).map(Number);
	// A token written once has the same value in both themes.
	const light = numbers.slice(0, 3) as [number, number, number];
	const dark = (numbers.length === 6 ? numbers.slice(3) : light) as [number, number, number];
	tokens.set(name, { light, dark });
}

/** Relative luminance, as WCAG defines it, of an OKLCH colour (conversion by Björn Ottosson). */
function luminance([lightness, chroma, hue]: [number, number, number]) {
	const a = chroma * Math.cos((hue * Math.PI) / 180);
	const b = chroma * Math.sin((hue * Math.PI) / 180);

	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
	const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(text: string, background: string, theme: Theme) {
	const [lighter, darker] = [text, background]
		.map((name) => {
			const token = tokens.get(name);
			if (!token) throw new Error(`layout.css has no --color-${name}`);
			return luminance(token[theme]);
		})
		.sort((first, second) => second - first);
	return (lighter + 0.05) / (darker + 0.05);
}

const BACKGROUNDS = ['canvas', 'surface', 'sunken'];
const TEXT = ['ink', 'ink-muted', 'ink-subtle', 'accent-text', 'good', 'warn', 'bad'];

describe.each(['light', 'dark'] as const)('colour tokens in the %s theme', (theme) => {
	it('finds the tokens it is meant to check', () => {
		for (const name of [...BACKGROUNDS, ...TEXT, 'accent', 'accent-ink', 'accent-soft']) {
			expect(tokens.has(name), `--color-${name}`).toBe(true);
		}
	});

	it.each(BACKGROUNDS.flatMap((background) => TEXT.map((text) => [text, background])))(
		'%s on %s reaches 4.5:1',
		(text, background) => {
			expect(contrast(text, background, theme)).toBeGreaterThanOrEqual(4.5);
		}
	);

	it.each(BACKGROUNDS)('ink on %s reaches 7:1', (background) => {
		expect(contrast('ink', background, theme)).toBeGreaterThanOrEqual(7);
	});

	it('accent-ink on accent, the filled buttons, reaches 4.5:1', () => {
		expect(contrast('accent-ink', 'accent', theme)).toBeGreaterThanOrEqual(4.5);
	});

	it('ink on accent-soft, the highlighted notices, reaches 7:1', () => {
		expect(contrast('ink', 'accent-soft', theme)).toBeGreaterThanOrEqual(7);
	});
});
