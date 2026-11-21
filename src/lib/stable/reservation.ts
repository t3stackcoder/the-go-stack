import { dev } from '$app/env';
import type { Attachment } from 'svelte/attachments';

/**
 * Development-only guard for reserved boxes.
 *
 * A reserved box promises that its height depends only on its width. If the height changes while
 * the width has not, whatever was swapped into it did not fit the space reserved for it, and
 * everything below it on the page just moved. That is reported here, at the moment it happens and
 * with the element at fault, rather than being left to show up as a layout-shift number later.
 *
 * In production the attachment is a no-op and the observer code is removed from the bundle.
 */
export const reservation: Attachment<HTMLElement> = (node) => {
	if (!dev) return;

	// Measured now, synchronously, rather than waiting for the observer's first report: that
	// report arrives a frame later, by which time late content may already have replaced the
	// placeholder and the size it reserved would never have been seen.
	let last: { width: number; height: number } = node.getBoundingClientRect();

	const observer = new ResizeObserver(([entry]) => {
		const { inlineSize: width, blockSize: height } = entry.borderBoxSize[0];

		if (Math.abs(width - last.width) < 0.5 && Math.abs(height - last.height) >= 0.5) {
			console.warn(
				`[stable] A reserved box changed height from ${last.height}px to ${height}px without changing width. ` +
					`Its content does not fit the space reserved for it, so the page shifted. ` +
					`Reserve the final size on the box (for example a fixed height or an aspect ratio).`,
				node
			);
		}

		last = { width, height };
	});

	observer.observe(node);
	return () => observer.disconnect();
};
