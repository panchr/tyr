import { defineCommand } from "citty";
import { ClaudeAgent } from "../agents/claude.ts";

const claudeConfig = defineCommand({
	meta: {
		name: "claude-config",
		description: "Print the merged Claude Code permission config",
	},
	args: {
		cwd: {
			type: "string",
			description: "Project directory (defaults to current directory)",
		},
	},
	async run({ args }) {
		const cwd = (args.cwd as string | undefined) ?? process.cwd();
		const agent = new ClaudeAgent();
		await agent.init(cwd);
		const info = agent.getDebugInfo();
		agent.close();

		console.log(JSON.stringify(info, null, 2));
	},
});

export default defineCommand({
	meta: {
		name: "debug",
		description: "Debugging and diagnostic tools",
	},
	subCommands: {
		"claude-config": claudeConfig,
	},
});
