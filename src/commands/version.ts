import { resolve } from "node:path";
import { defineCommand } from "citty";

export default defineCommand({
	meta: {
		name: "version",
		description: "Print tyr version and runtime info",
	},
	async run() {
		const pkgPath = resolve(import.meta.dir, "../../package.json");
		const pkg = await Bun.file(pkgPath).json();
		const version = (pkg as Record<string, unknown>).version ?? "unknown";
		console.log(`tyr ${version}`);
		console.log(`bun ${Bun.version}`);
		console.log(`${process.platform} ${process.arch}`);
	},
});
