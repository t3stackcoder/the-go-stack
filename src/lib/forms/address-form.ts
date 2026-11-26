import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';

/**
 * For a GET form whose fields are the page's query string: a search box, a set of filters, the
 * questions on the Verdict page. Call it while the component is being set up.
 *
 * Such a form's fields must take the address as their defaults (`defaultValue`,
 * `defaultChecked`), not as `value` or `checked`. A default is where a field starts, and the
 * browser keeps whatever the visitor enters after that. Written as `value`, hydration sets each
 * field back to what the server sent, and anything entered while the page was still loading is
 * erased. Measured on this site with its scripts held back: three characters typed into the
 * search box were gone when hydration finished.
 *
 * Defaults leave two moments when the form and the address disagree, and both are settled here.
 *
 * @param form The form element. Read after the component has mounted, so a `bind:this` will do.
 * @param agrees Whether these fields say what the address already says.
 */
export function addressForm(form: () => HTMLFormElement, agrees: (fields: FormData) => boolean) {
	// `reset` and `requestSubmit` are called from the prototype. Called on the form itself, a field
	// with either name would be found in place of the method.

	// The address changed and no form was the cause (a link, Back). The fields have their new
	// defaults by now, and a reset is what shows them.
	afterNavigate(({ type }) => {
		if (type !== 'enter' && type !== 'form') HTMLFormElement.prototype.reset.call(form());
	});

	// Something entered before hydration is in the form and not in the address: nothing was
	// listening when it changed. Send the form now, as the change would have.
	onMount(() => {
		// Not at once. The router starts listening for forms just after the page has mounted, and
		// sent before then the form would go the browser's own way: a new page, a new history entry.
		const timer = setTimeout(() => {
			if (!agrees(new FormData(form()))) HTMLFormElement.prototype.requestSubmit.call(form());
		});
		return () => clearTimeout(timer);
	});
}
