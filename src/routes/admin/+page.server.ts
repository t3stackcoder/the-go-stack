import { can, requirePermission } from '#lib/server/auth/access.js';
import type { PageServerLoad } from './$types';

/**
 * The admin area's front page: the things the visitor's role lets them do here, each a page of
 * its own. Getting this far was checked in src/hooks.server.ts; which of them the role allows is
 * decided here, so that a role given only some of them is offered only those.
 */
export const load: PageServerLoad = async (event) => {
	const { user } = await requirePermission(event, { adminArea: ['open'] });

	return {
		tools: {
			health: can(user, { services: ['view'] })
		}
	};
};
