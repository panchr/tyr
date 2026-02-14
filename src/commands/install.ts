import { defineCommand } from "citty";

export default defineCommand({
	meta: {
		name: "install",
		description: "Register tyr as a Claude Code hook",
	},
	args: {
		global: {
			type: "boolean",
			description: "Write to ~/.claude/settings.json (default)",
		},
		project: {
			type: "boolean",
			description: "Write to .claude/settings.json",
		},
		"dry-run": {
			type: "boolean",
			description: "Print what would be written without modifying anything",
		},
	},
	run() {
		console.error("tyr install: not yet implemented");
		process.exit(1);
	},
});
