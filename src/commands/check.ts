import { defineCommand } from "citty";

export default defineCommand({
	meta: {
		name: "check",
		description: "Evaluate a permission request (hook entry point)",
	},
	args: {
		verbose: {
			type: "boolean",
			description: "Emit debug info to stderr",
		},
	},
	run() {
		console.error("tyr check: not yet implemented");
		process.exit(1);
	},
});
