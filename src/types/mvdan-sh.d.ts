/** Minimal type declarations for mvdan-sh (GopherJS shell parser). */
declare module "mvdan-sh" {
	interface ShellNode {
		[key: string]: unknown;
	}

	interface Parser {
		/** Parse a shell string into an AST. Throws on syntax errors. */
		Parse(input: string, name: string): ShellNode;
	}

	interface Syntax {
		/** Return the AST node type name (e.g. "CallExpr", "Lit", "DblQuoted"). */
		NodeType(node: unknown): string;
		/** Create a new shell parser instance. */
		NewParser(): Parser;
		/** Walk an AST tree, calling the visitor for each node. Return true to continue. */
		Walk(node: ShellNode, visitor: (node: ShellNode | null) => boolean): void;
	}

	const syntax: Syntax;
	export { syntax, type ShellNode };
}
