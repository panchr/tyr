import { defineCommand } from "citty";
import { rejectUnknownArgs } from "../args.ts";

const configArgs = {};

export default defineCommand({
	meta: {
		name: "config",
		description: "View and manage tyr configuration",
	},
	args: configArgs,
	run({ rawArgs }) {
		rejectUnknownArgs(rawArgs, configArgs);
		console.error("tyr config: not yet implemented");
		process.exit(1);
	},
});
