import { syntax } from "mvdan-sh";

/** A simple command extracted from a shell string. */
export interface SimpleCommand {
	/** The full command text reconstructed from the AST (e.g. "git commit -m test"). */
	command: string;
	/** Individual arguments including the command name. */
	args: string[];
}

/** Extract the string value of a Word AST node. */
function wordToString(word: unknown): string {
	const w = word as { Parts: unknown[] };
	let result = "";
	for (let i = 0; i < w.Parts.length; i++) {
		const part = w.Parts[i] as Record<string, unknown>;
		const partType = syntax.NodeType(part) as string;
		if (partType === "Lit") {
			result += part.Value;
		} else if (partType === "SglQuoted") {
			result += part.Value;
		} else if (partType === "DblQuoted") {
			const inner = part.Parts as unknown[];
			for (let j = 0; j < inner.length; j++) {
				const ip = inner[j] as Record<string, unknown>;
				if (syntax.NodeType(ip) === "Lit") {
					result += ip.Value;
				}
				// For parameter expansions, command substitutions inside
				// double quotes we skip — they're dynamic and can't be
				// statically resolved.
			}
		}
		// CmdSubst, ParamExp, etc. are dynamic — we skip them.
	}
	return result;
}

/** Parse a shell command string and extract all simple commands.
 *
 *  Handles pipes (`|`), logical operators (`&&`, `||`), semicolons (`;`),
 *  subshells (`(cmd)`), and command substitution (`$(cmd)`).
 *  Returns an empty array if parsing fails. */
export function parseCommands(input: string): SimpleCommand[] {
	const parser = syntax.NewParser();
	let file: import("mvdan-sh").ShellNode;
	try {
		file = parser.Parse(input, "");
	} catch {
		return [];
	}

	const commands: SimpleCommand[] = [];

	syntax.Walk(file, (node) => {
		if (!node) return true;
		if (syntax.NodeType(node) !== "CallExpr") return true;

		const call = node as { Args: unknown[] };
		if (!call.Args || call.Args.length === 0) return true;

		const args: string[] = [];
		for (let i = 0; i < call.Args.length; i++) {
			args.push(wordToString(call.Args[i]));
		}

		commands.push({
			command: args.join(" "),
			args,
		});

		return true;
	});

	return commands;
}
