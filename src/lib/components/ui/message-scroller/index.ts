import Root from './message-scroller.svelte';
import Button from './message-scroller-button.svelte';
import Content from './message-scroller-content.svelte';
import Item from './message-scroller-item.svelte';
import Provider from './message-scroller-provider.svelte';
import Viewport from './message-scroller-viewport.svelte';

export {
	useMessageScroller,
	useMessageScrollerScrollable,
	useMessageScrollerVisibility
} from '@shadcn-svelte/primitives/message-scroller';

export {
	Button,
	Button as MessageScrollerButton,
	Content,
	Content as MessageScrollerContent,
	Item,
	Item as MessageScrollerItem,
	Provider,
	//
	Provider as MessageScrollerProvider,
	Root,
	Root as MessageScroller,
	Viewport,
	Viewport as MessageScrollerViewport
};
