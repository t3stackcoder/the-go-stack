// This file must stay a script (no imports or exports) for the wildcard declaration to be global.

/**
 * An image import that lists the widths to build: `ridge.jpg?w=480;960&enhanced`. The plain
 * `ridge.jpg?enhanced` form is declared by `@sveltejs/enhanced-img` itself.
 */
declare module '*&enhanced' {
	const picture: import('@sveltejs/enhanced-img').Picture;
	export default picture;
}
