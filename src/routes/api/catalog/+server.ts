import { createCatalog } from '#lib/demo/catalog.js';

export function GET() {
	return Response.json(createCatalog());
}
