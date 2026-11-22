import Root, { type BubbleVariant, bubbleVariants } from './bubble.svelte';
import Content from './bubble-content.svelte';
import Group from './bubble-group.svelte';
import Reactions, {
	type BubbleReactionsAlign,
	type BubbleReactionsSide,
	bubbleReactionsVariants
} from './bubble-reactions.svelte';

export {
	type BubbleReactionsAlign,
	type BubbleReactionsSide,
	type BubbleVariant,
	bubbleReactionsVariants,
	bubbleVariants,
	Content,
	Content as BubbleContent,
	Group,
	Group as BubbleGroup,
	Reactions,
	Reactions as BubbleReactions,
	Root,
	//
	Root as Bubble
};
