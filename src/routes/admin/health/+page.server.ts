/**
 * The health check: every service in compose.yaml, how each one is, and a way to start or stop
 * it. Seeing them takes `services: view` and starting or stopping one takes `services: control`
 * (src/lib/server/auth/access.ts), on top of getting into the admin area at all, which
 * src/hooks.server.ts has already checked.
 */
import { error } from '@sveltejs/kit';
import * as z from 'zod';
import { saveAction, stopIfAbandoned } from '#lib/forms/server/save-action.js';
import { can, requirePermission } from '#lib/server/auth/access.js';
import {
	describeFailure,
	isService,
	listServices,
	startService,
	stopService,
	stopWithheldFor
} from '#lib/server/services.js';
import { streaming } from '#lib/server/streaming.js';
import { SERVICE_COUNT } from '$app/env/private';
import type { PageServerLoad, RequestEvent } from './$types';

/** When Docker answered, as the page prints it. In UTC, as the account page does. */
const UTC = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

/**
 * How long the list is given, in milliseconds. Each command it runs is given ten seconds of its
 * own (src/lib/server/services.ts), and the two run side by side.
 */
const LIST_LIMIT = 15_000;

export const load: PageServerLoad = async (event) => {
	const { user } = await requirePermission(event, { services: ['view'] });

	// Not waited for. Each `docker compose` command takes a second or more to answer, most of
	// it the command starting up (1.1 to 1.4 s each, measured on Windows), and the page sat
	// blank for that long before it appeared. It is sent at once now, and the list follows in
	// the same response when Docker has answered.
	return streaming(event, LIST_LIMIT, {
		listing: listServices().then((listing) => ({
			...listing,
			checkedAt: UTC.format(new Date())
		})),
		mayControl: can(user, { services: ['control'] }),
		// How many rows to draw until Docker has answered, from the environment (src/env.ts).
		serviceCount: SERVICE_COUNT
	});
};

/** The one field each form sends: which service it is about. */
const Named = z.object({ service: z.string().min(1) });

/**
 * The service a form names, once it is known to be one and the visitor may start and stop it.
 * Only a name compose.yaml gives is ever passed on to Docker.
 */
async function serviceNamed(event: RequestEvent, service: string): Promise<string> {
	await requirePermission(event, { services: ['control'] });
	let known: boolean;
	try {
		known = await isService(service);
	} catch (failure) {
		dockerFailed(failure);
	}
	if (!known) error(404, 'There is no service by that name in compose.yaml.');
	return service;
}

/**
 * Ends the action with what Docker said. It is said to the administrator in full, because it
 * is what names the port that is taken or the image that could not be fetched, and nobody else
 * can be shown this page.
 */
function dockerFailed(failure: unknown): never {
	const { summary, detail } = describeFailure(failure);
	error(502, detail ? `${summary} ${detail}` : summary);
}

export const actions = {
	/**
	 * Starts a service and waits until it passes its health check, so that the page reloads to
	 * how it is and not to "starting". Asking to start one that is already running changes
	 * nothing, so a press that arrives twice does no harm.
	 */
	start: saveAction('start', Named, async ({ service }, event) => {
		const name = await serviceNamed(event, service);
		stopIfAbandoned(event);
		try {
			await startService(name);
		} catch (failure) {
			dockerFailed(failure);
		}
		return { action: 'start' as const, said: `${name} is running and healthy.` };
	}),

	/**
	 * Stops a service, keeping its container and its data. Stopping one that is already stopped
	 * changes nothing.
	 */
	stop: saveAction('stop', Named, async ({ service }, event) => {
		const name = await serviceNamed(event, service);
		// The page offers no Stop for it, and a form written by hand is no different.
		const withheld = stopWithheldFor(name);
		if (withheld) error(409, withheld);

		stopIfAbandoned(event);
		try {
			await stopService(name);
		} catch (failure) {
			dockerFailed(failure);
		}
		return { action: 'stop' as const, said: `${name} is stopped.` };
	})
};
