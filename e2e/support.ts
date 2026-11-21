import { globSync } from 'node:fs';
import { expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Dynamic routes cannot be visited without parameter values. List one concrete URL for each here,
 * keyed by route id (for example `'/blog/[slug]': '/blog/hello-world'`).
 */
const DYNAMIC_ROUTE_SAMPLES: Record<string, string> = {};

/**
 * Every page in the app, discovered from the filesystem.
 *
 * Discovery is what makes the stability audit generic: a new page is audited the moment its file
 * exists, with nothing to register. A dynamic route with no sample URL is an error rather than a
 * silent gap in coverage.
 */
export const routes: string[] = globSync('src/routes/**/+page.svelte').map((file) => {
	const id =
		'/' +
		file
			.replaceAll('\\', '/')
			.replace(/^src\/routes\/?/, '')
			.replace(/\/?\+page\.svelte$/, '')
			.split('/')
			// Route groups such as `(marketing)` organise files and are not part of the URL.
			.filter((segment) => segment && !/^\(.+\)$/.test(segment))
			.join('/');

	if (!id.includes('[')) return id;

	const sample = DYNAMIC_ROUTE_SAMPLES[id];
	if (!sample) {
		throw new Error(
			`Route ${id} is dynamic and has no sample URL. Add one to DYNAMIC_ROUTE_SAMPLES in e2e/support.ts.`
		);
	}
	return sample;
});

/**
 * An address with no page behind it. Discovery cannot find the not-found page, because it has no
 * file of its own, so it is added to the audit by name.
 */
export const MISSING_PAGE = '/no-page-lives-here';

/** Everything the audit visits: every page, and the page shown where there is none. */
export const auditedPages = [...routes, MISSING_PAGE];

/** The pages that are meant to answer with an error. Every other page must answer 200. */
const ERROR_PAGES: Record<string, number> = {
	[MISSING_PAGE]: 404,
	// A documented demo of a server failure. See src/routes/stability/failure/+page.server.ts.
	'/stability/failure': 500
};

export const expectedStatus = (route: string) => ERROR_PAGES[route] ?? 200;

/**
 * The browser logs an error to the console for any response with an error status. For a page that
 * is meant to answer with one, that message reports the page working, not a problem with it.
 */
export function reportsExpectedStatus(message: ConsoleMessage, route: string) {
	return (
		expectedStatus(route) !== 200 &&
		message.text().startsWith('Failed to load resource') &&
		new URL(message.location().url).pathname.startsWith(route)
	);
}

export interface LayoutShift {
	value: number;
	/** When it happened, in milliseconds since the document started loading. */
	at: number;
	/** The elements that moved, described well enough to find them. */
	moved: string[];
}

declare global {
	interface Window {
		__layoutShifts: LayoutShift[];
		__measureBoxes: () => Box[];
		__sameDocument?: true;
		__firstFrame?: { at: number; boxes: Box[] };
	}
}

/** Records every layout shift from the start of the next navigation. Call before `page.goto`. */
export async function recordLayoutShifts(page: Page) {
	await page.addInitScript(() => {
		window.__layoutShifts = [];

		const describe = (node: Node | null) => {
			if (!(node instanceof Element)) return node?.nodeName ?? 'unknown node';
			const id = node.id ? `#${node.id}` : '';
			const classes = [...node.classList].slice(0, 3).map((name) => `.${name}`);
			const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
			return `<${node.tagName.toLowerCase()}${id}${classes.join('')}>${text ? ` "${text}"` : ''}`;
		};

		new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as (PerformanceEntry & {
				value: number;
				sources: { node: Node | null }[];
			})[]) {
				window.__layoutShifts.push({
					value: entry.value,
					at: entry.startTime,
					moved: entry.sources.map((source) => describe(source.node))
				});
			}
		}).observe({ type: 'layout-shift', buffered: true });
	});
}

export function readLayoutShifts(page: Page): Promise<LayoutShift[]> {
	return page.evaluate(() => window.__layoutShifts);
}

/**
 * Waits until the page has nothing left to do: the document (including anything streamed into it)
 * has finished, the network is quiet, fonts have settled, and arrival animations have ended.
 */
export async function settle(page: Page) {
	await page.waitForLoadState('load');
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(300);
}

/**
 * Waits until the page has drawn a frame. The font is settled by then (see src/app.html), so what
 * is measured afterwards is what was painted. `document.fonts.ready` would not do here: in WebKit
 * it stays pending until the whole document has loaded, which never happens while scripts are held.
 */
export async function firstFrame(page: Page) {
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)))
	);
}

const APP_SCRIPTS = '**/_app/immutable/**/*.js';
const IMAGES = /\.(avif|webp|jpe?g|png|gif)(\?|$)/;

/**
 * Stops the app's JavaScript from loading, which freezes the page in the state the server painted:
 * HTML, CSS and the inline theme boot script, with hydration never happening.
 */
export async function blockAppScripts(page: Page) {
	await page.route(APP_SCRIPTS, (route) => route.abort());
}

/**
 * Holds back everything that lands on a page after its HTML, namely the app's JavaScript and every
 * image, until the returned function is called. Until then the page is exactly what the server
 * painted, with each image an empty box; afterwards the same page hydrates and fills in. Measuring
 * on either side of the release compares one response with itself, so a page that legitimately
 * differs from request to request (a timestamp, a live figure) is not mistaken for one that changed
 * after it was painted.
 */
export async function holdLateArrivals(page: Page) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));

	for (const late of [APP_SCRIPTS, IMAGES]) {
		await page.route(late, async (route) => {
			await released;
			await route.continue();
		});
	}

	return release;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The conditions under which jank normally shows up: a slow processor, a font and images that
 * arrive long after first paint, and scripts that arrive late, stretching the gap between paint and
 * hydration.
 */
export async function simulateSlowDevice(page: Page) {
	const session = await page.context().newCDPSession(page);
	await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });

	await page.route('**/*.woff2', async (route) => {
		await delay(1500);
		await route.continue();
	});
	await page.route(IMAGES, async (route) => {
		await delay(1000);
		await route.continue();
	});
	await page.route(APP_SCRIPTS, async (route) => {
		await delay(400);
		await route.continue();
	});
}

/**
 * Brings every image on the page into view and waits for it to finish loading, then returns to
 * where the page was. Images below the fold are not requested until the visitor scrolls near
 * them, so without this they would never arrive and never be judged.
 */
export async function revealImages(page: Page) {
	await page.evaluate(async () => {
		const { scrollX: x, scrollY: y } = window;

		for (const image of document.images) {
			image.scrollIntoView({ block: 'center', behavior: 'instant' });
			if (!image.complete) {
				await new Promise((resolve) => {
					image.addEventListener('load', resolve, { once: true });
					image.addEventListener('error', resolve, { once: true });
				});
			}
			// One frame, so that whatever the image did to the layout has happened.
			await new Promise(requestAnimationFrame);
		}

		window.scrollTo({ left: x, top: y, behavior: 'instant' });
	});
}

export interface Box {
	/** Where the element sits in the document, as a readable trail of tags. */
	path: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** The element's own text, excluding its descendants'. */
	text: string;
}

/**
 * The position, size and text of every element on the page, in document order.
 *
 * The contents of reserved boxes are left out, because changing after first paint is what they are
 * for. The boxes themselves are included: a reserved box that changes size is exactly the failure
 * this is meant to catch.
 *
 * It runs in the browser and is sent there as source, so it must not refer to anything outside
 * itself.
 */
function measureBoxes(): Box[] {
	const round = (value: number) => Math.round(value * 100) / 100;
	const boxes: Box[] = [];

	const visit = (element: Element, trail: string) => {
		const index = element.parentElement ? [...element.parentElement.children].indexOf(element) : 0;
		const path = `${trail}/${element.tagName.toLowerCase()}[${index}]`;
		const rect = element.getBoundingClientRect();

		boxes.push({
			path,
			x: round(rect.x + scrollX),
			y: round(rect.y + scrollY),
			width: round(rect.width),
			height: round(rect.height),
			text: [...element.childNodes]
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.textContent?.trim() ?? '')
				.join(' ')
				.trim()
		});

		if (element.hasAttribute('data-reserve')) return;
		for (const child of element.children) {
			if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(child.tagName)) continue;
			// SvelteKit adds this live region after hydration to announce page changes to screen
			// readers. It is a 1px, clipped, absolutely positioned element: it shows nothing and
			// cannot move anything, so it is not a change to the painted page.
			if (child.id === 'svelte-announcer') continue;
			visit(child, path);
		}
	};

	visit(document.body, '');
	return boxes;
}

export function measurePage(page: Page): Promise<Box[]> {
	return page.evaluate(measureBoxes);
}

export interface Arrival {
	/**
	 * Whether the router swapped the page in place. False means the browser loaded a new document,
	 * which is how a page that ships no JavaScript is reached.
	 */
	clientSide: boolean;
	/**
	 * When the new page's first frame had been drawn, on the clock layout shifts are timed by. Zero
	 * for a new document, where everything counts.
	 */
	at: number;
	/** Every element as it stood in that first frame. */
	firstFrame: Box[];
}

/**
 * Makes `arriveByLink` possible. Call before `page.goto`, along with `recordLayoutShifts` if
 * shifts are to be read afterwards.
 *
 * Images are slowed a little. From a server on the same machine they would otherwise arrive
 * before the new page's first frame, which no visitor's connection manages, and an image that
 * moved the page as it landed would go unseen.
 */
export async function prepareArrival(page: Page) {
	await page.addInitScript(`window.__measureBoxes = ${measureBoxes.toString()}`);
	await page.route(IMAGES, async (route) => {
		await delay(300);
		await route.continue();
	});
}

/**
 * Goes to `to` the way a visitor does, by clicking a link on the page that is open, and reports
 * the new page as it stood in its first frame.
 *
 * The first frame is found from inside the page, because nothing outside it is fast enough. The
 * router replaces the contents of <main>. The next frame is the first to show the new page, and a
 * task queued from that frame's animation callback runs as soon as the frame has been drawn.
 * Anything that moves from then on moved in front of the visitor. Things that persist across pages
 * (the footer, the readout) are repositioned in that first frame, which is a new page being drawn,
 * not a page moving.
 */
export async function arriveByLink(page: Page, to: string): Promise<Arrival> {
	await page.evaluate((href) => {
		const main = document.querySelector('main')!;

		// Not every page links to every other, so the audit brings its own link. It sits beside
		// <main>, inside the element the router listens on, and is fixed so that it takes no space.
		const link = document.createElement('a');
		link.id = 'audit-link';
		link.href = href;
		link.textContent = 'audit';
		link.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 1000';
		main.after(link);

		window.__sameDocument = true;
		new MutationObserver((_, observer) => {
			observer.disconnect();
			requestAnimationFrame(() =>
				setTimeout(() => {
					window.__firstFrame = { at: performance.now(), boxes: window.__measureBoxes() };
				})
			);
		}).observe(main, { childList: true, subtree: true });
	}, to);

	await page.locator('#audit-link').click();
	await page.waitForURL(to);
	const firstFrame = await page.waitForFunction(
		() => window.__firstFrame ?? !window.__sameDocument
	);
	const value = await firstFrame.jsonValue();

	if (typeof value === 'boolean') {
		await page.waitForLoadState('domcontentloaded');
		return { clientSide: false, at: 0, firstFrame: await measurePage(page) };
	}
	return { clientSide: true, at: value.at, firstFrame: value.boxes };
}

/** Whether the document that is open has downloaded any of the app's JavaScript. */
export function runsAppScripts(page: Page): Promise<boolean> {
	return page.evaluate(() =>
		performance
			.getEntriesByType('resource')
			.some((entry) => entry.name.includes('/_app/immutable/') && /\.js(\?|$)/.test(entry.name))
	);
}

/** Lightness (0 to 1) of the page background, read from the OKLCH value the browser computed. */
async function canvasLightness(page: Page) {
	const color = await page.evaluate(
		() => getComputedStyle(document.documentElement).backgroundColor
	);
	const match = /^oklch\(([\d.]+)/.exec(color);
	if (!match) throw new Error(`Expected an oklch() background colour, got "${color}"`);
	return Number(match[1]);
}

export const expectLight = async (page: Page) =>
	expect(await canvasLightness(page)).toBeGreaterThan(0.9);
export const expectDark = async (page: Page) =>
	expect(await canvasLightness(page)).toBeLessThan(0.3);
