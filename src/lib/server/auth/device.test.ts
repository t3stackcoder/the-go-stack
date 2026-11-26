// The account page names each session by its browser, so that a visitor can tell which is
// theirs. Each string here is what a real browser sends, and the trap in most of them is that it
// also names a browser it is not: Edge says Chrome, Chrome says Safari, Android says Linux.

import { describe, expect, it } from 'vitest';
import { describeAddress, describeDevice } from './device.js';

describe('what a session is called', () => {
	it.each([
		[
			'Chrome on Windows',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
		],
		[
			'Chrome on Windows',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/142.0.0.0 Safari/537.36'
		],
		[
			'Edge on Windows',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'
		],
		[
			'Opera on Windows',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0'
		],
		[
			'Firefox on Windows',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0'
		],
		[
			'Firefox on Linux',
			'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0'
		],
		[
			'Safari on macOS',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
		],
		[
			'Chrome on macOS',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
		],
		[
			'Safari on iOS',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
		],
		[
			'Chrome on iOS',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1'
		],
		[
			'Firefox on iOS',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15'
		],
		[
			'Chrome on Android',
			'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
		],
		[
			'Samsung Internet on Android',
			'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Mobile Safari/537.36'
		],
		[
			'Chrome on ChromeOS',
			'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
		]
	])('%s', (expected, userAgent) => {
		expect(describeDevice(userAgent)).toBe(expected);
	});

	it('says what it does not know, and nothing it does not', () => {
		expect(describeDevice(undefined)).toBe('Unknown browser');
		expect(describeDevice(null)).toBe('Unknown browser');
		expect(describeDevice('')).toBe('Unknown browser');
		expect(describeDevice('curl/8.11.1')).toBe('Unknown browser');
		// A browser it does not know, on a system it does.
		expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64) Konqueror/24.12')).toBe(
			'Unknown browser on Linux'
		);
		// A browser it knows, on a system it does not.
		expect(describeDevice('Mozilla/5.0 (Haiku; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe(
			'Firefox'
		);
	});
});

describe('where a session signed in from', () => {
	it('is an IPv4 address as it stands', () => {
		expect(describeAddress('203.0.113.7')).toBe('203.0.113.7');
	});

	it('is the network an IPv6 address was kept as, in its short form', () => {
		// As Better Auth stores 2001:db8:12:34:abcd:ef01:2345:6789.
		expect(describeAddress('2001:0db8:0012:0034:0000:0000:0000:0000')).toBe('2001:db8:12:34::/64');
		expect(describeAddress('2a00:0000:0000:0001:0000:0000:0000:0000')).toBe('2a00:0:0:1::/64');
	});

	it("is the server's own machine for a loopback address, in either family", () => {
		// As Better Auth stores ::1.
		expect(describeAddress('0000:0000:0000:0000:0000:0000:0000:0000')).toBe(
			"The server's own machine"
		);
		expect(describeAddress('127.0.0.1')).toBe("The server's own machine");
	});

	it('is left as it is when it is not in a form this knows', () => {
		// A whole IPv6 address, which Better Auth would not store, is not made into a network.
		expect(describeAddress('2001:0db8:0012:0034:abcd:ef01:2345:6789')).toBe(
			'2001:0db8:0012:0034:abcd:ef01:2345:6789'
		);
		expect(describeAddress('not an address')).toBe('not an address');
	});

	it('is not known when nothing was recorded', () => {
		expect(describeAddress(null)).toBeNull();
		expect(describeAddress(undefined)).toBeNull();
		expect(describeAddress('')).toBeNull();
	});
});
