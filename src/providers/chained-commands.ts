import type { ClaudeAgent } from "../agents/claude.ts";
import type { PermissionRequest, Provider, ProviderResult } from "../types.ts";
import { parseCommands } from "./shell-parser.ts";

/** Provider that splits chained shell commands and checks each sub-command
 *  against the Claude agent's configured permissions.
 *
 *  - If every sub-command is individually allowed → allow.
 *  - If any sub-command is denied → deny.
 *  - Otherwise (any unknown) → abstain. */
export class ChainedCommandsProvider implements Provider {
	readonly name = "chained-commands";

	constructor(
		private agent: ClaudeAgent,
		private verbose = false,
	) {}

	async checkPermission(req: PermissionRequest): Promise<ProviderResult> {
		if (req.tool_name !== "Bash") return { decision: "abstain" };

		const command = req.tool_input.command;
		if (typeof command !== "string" || command.trim() === "")
			return { decision: "abstain" };

		const subCommands = parseCommands(command);
		if (subCommands.length === 0) return { decision: "abstain" };

		let allAllowed = true;
		for (const sub of subCommands) {
			const result = this.agent.isCommandAllowed(sub.command);
			if (this.verbose) {
				console.error(`[tyr] chained-commands: "${sub.command}" → ${result}`);
			}
			if (result === "deny") return { decision: "deny" };
			if (result !== "allow") allAllowed = false;
		}

		const decision = allAllowed ? "allow" : "abstain";
		if (this.verbose) {
			console.error(`[tyr] chained-commands: overall → ${decision}`);
		}
		return { decision };
	}
}
