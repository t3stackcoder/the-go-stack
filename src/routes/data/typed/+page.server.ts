import { arch, memoryUsage, platform, version } from 'node:process';

// Rendered for each request, so every value below is read fresh.
export const prerender = false;

// This runs only on the server. It could just as well query a database or read a secret:
// none of this code is sent to the browser, only what it returns.
export function load() {
	return {
		runtime: { name: 'Node.js', version, platform, arch },
		memory: { residentBytes: memoryUsage.rss() },
		// A real Date. It arrives in the page as a Date, not as a string to parse.
		renderedAt: new Date()
	};
}
