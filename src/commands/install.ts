import { defineCommand } from "citty";
import { rejectUnknownArgs } from "../args.ts";
import {
	getSettingsPath,
	isInstalled,
	mergeHook,
	readSettings,
	writeSettings,
} from "../install.ts";

const installArgs = {
	global: {
		type: "boolean" as const,
		description: "Write to ~/.claude/settings.json (default)",
	},
	project: {
		type: "boolean" as const,
		description: "Write to .claude/settings.json",
	},
	"dry-run": {
		type: "boolean" as const,
		description: "Print what would be written without modifying anything",
	},
};

export default defineCommand({
	meta: {
		name: "install",
		description: "Register tyr as a Claude Code hook",
	},
	args: installArgs,
	async run({ args, rawArgs }) {
		rejectUnknownArgs(rawArgs, installArgs);
		const scope = args.project ? "project" : "global";
		const dryRun = args["dry-run"] ?? false;
		const settingsPath = getSettingsPath(scope);

		const settings = await readSettings(settingsPath);
		const alreadyInstalled = isInstalled(settings);
		const updated = mergeHook(settings);

		if (dryRun) {
			console.log(`Would write to ${settingsPath}:\n`);
			console.log(JSON.stringify(updated, null, 2));
			return;
		}

		await writeSettings(settingsPath, updated);
		if (alreadyInstalled) {
			console.log(`Updated tyr hook in ${settingsPath}`);
		} else {
			console.log(`Installed tyr hook in ${settingsPath}`);
		}
	},
});
