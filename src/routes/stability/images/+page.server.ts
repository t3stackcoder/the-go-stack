import { asset } from '$app/paths';

// The photograph below is described by data that arrives with the request, so the page is
// rendered per request.
export const prerender = false;

// Stands in for a row from a database or a content system: an address, and the dimensions that
// were recorded when the file was uploaded. Nothing about this image is known at build time.
export function load() {
	return {
		photo: {
			src: asset('images/harbour.jpg'),
			width: 1200,
			height: 800,
			caption: 'Layered hills in green, under a pale sun'
		}
	};
}
