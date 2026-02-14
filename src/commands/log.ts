import { defineCommand } from "citty";

export default defineCommand({
	meta: {
		name: "log",
		description: "View permission check history",
	},
	args: {
		last: {
			type: "string",
			description: "Show last N entries (default: 20)",
		},
		json: {
			type: "boolean",
			description: "Raw JSON output",
		},
		follow: {
			type: "boolean",
			alias: "f",
			description: "Tail the log",
		},
	},
	run() {
		console.error("tyr log: not yet implemented");
		process.exit(1);
	},
});
