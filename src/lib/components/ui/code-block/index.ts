import Root, {
	type CodeBlockSize,
	type CodeBlockVariant,
	codeBlockVariants
} from './code-block.svelte';
import Actions from './code-block-actions.svelte';
import Content from './code-block-content.svelte';
import CopyButton from './code-block-copy-button.svelte';
import Footer from './code-block-footer.svelte';
import Header from './code-block-header.svelte';
import Line, {
	type CodeBlockLineToken,
	type CodeBlockLineVariant,
	codeBlockLineVariants
} from './code-block-line.svelte';
import Title from './code-block-title.svelte';

export {
	Actions,
	Actions as CodeBlockActions,
	type CodeBlockLineToken,
	type CodeBlockLineVariant,
	type CodeBlockSize,
	type CodeBlockVariant,
	Content,
	Content as CodeBlockContent,
	CopyButton,
	CopyButton as CodeBlockCopyButton,
	codeBlockLineVariants,
	codeBlockVariants,
	Footer,
	Footer as CodeBlockFooter,
	Header,
	Header as CodeBlockHeader,
	Line,
	Line as CodeBlockLine,
	Root,
	//
	Root as CodeBlock,
	Title,
	Title as CodeBlockTitle
};
