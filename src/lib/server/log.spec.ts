import { afterEach, describe, expect, it, vi } from 'vitest';
import { record } from './log.js';

afterEach(() => vi.restoreAllMocks());

describe('record', () => {
	it('writes an error as one line of JSON on standard error', () => {
		const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});

		record('error', 'unexpected error', { reference: 'abc123', stack: 'Error: x\n    at y' });

		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledOnce();

		const line = stderr.mock.calls[0][0] as string;
		expect(line).not.toContain('\n');

		const entry = JSON.parse(line) as { time: string };
		expect(entry).toMatchObject({
			level: 'error',
			event: 'unexpected error',
			reference: 'abc123',
			stack: 'Error: x\n    at y'
		});
		expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
	});

	it('writes anything else on standard output', () => {
		const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});

		record('info', 'request refused', { status: 404 });

		expect(stderr).not.toHaveBeenCalled();
		expect(JSON.parse(stdout.mock.calls[0][0] as string)).toMatchObject({
			level: 'info',
			event: 'request refused',
			status: 404
		});
	});
});
