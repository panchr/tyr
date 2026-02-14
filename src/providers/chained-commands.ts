import type { ClaudeAgent } from "../agents/claude.ts";
import type {
	PermissionRequest,
	PermissionResult,
	Provider,
} from "../types.ts";
import { parseCommands } from "./shell-parser.ts";

/** Provider that splits chained shell commands and checks each sub-command
 *  against the Claude agent's configured permissions.
 *
 *  - If every sub-command is individually allowed → allow.
 *  - If any sub-command is denied → deny.
 *  - Otherwise (any unknown) → abstain. */
export class ChainedCommandsProvider implements Provider {
	readonly name = "chained-commands";

	constructor(private agent: ClaudeAgent) {}

	async checkPermission(req: PermissionRequest): Promise<PermissionResult> {
		if (req.tool_name !== "Bash") return "abstain";

		const command = req.tool_input.command;
		if (typeof command !== "string" || command.trim() === "") return "abstain";

		const subCommands = parseCommands(command);
		if (subCommands.length === 0) return "abstain";

		let allAllowed = true;
		for (const sub of subCommands) {
			const result = this.agent.isCommandAllowed(sub.command);
			if (result === "deny") return "deny";
			if (result !== "allow") allAllowed = false;
		}

		return allAllowed ? "allow" : "abstain";
	}
}
