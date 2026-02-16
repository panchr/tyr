import { defineCommand } from "citty";
import { VERSION } from "../version.ts";

export default defineCommand({
	meta: {
		name: "version",
		description: "Print tyr version and runtime info",
	},
	run() {
		console.log(`tyr ${VERSION}`);
		console.log(`bun ${Bun.version}`);
		console.log(`${process.platform} ${process.arch}`);
	},
});
