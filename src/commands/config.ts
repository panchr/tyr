import { defineCommand } from "citty";

export default defineCommand({
	meta: {
		name: "config",
		description: "View and manage tyr configuration",
	},
	run() {
		console.error("tyr config: not yet implemented");
		process.exit(1);
	},
});
