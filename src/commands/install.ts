import { defineCommand } from "citty";
import {
	getSettingsPath,
	isInstalled,
	mergeHook,
	readSettings,
	writeSettings,
} from "../install.ts";

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
	async run({ args }) {
		const scope = args.project ? "project" : "global";
		const dryRun = args["dry-run"] ?? false;
		const settingsPath = getSettingsPath(scope);

		const settings = await readSettings(settingsPath);

		if (isInstalled(settings)) {
			console.log(`tyr hook already installed in ${settingsPath}`);
			return;
		}

		const updated = mergeHook(settings);

		if (dryRun) {
			console.log(`Would write to ${settingsPath}:\n`);
			console.log(JSON.stringify(updated, null, 2));
			return;
		}

		await writeSettings(settingsPath, updated);
		console.log(`Installed tyr hook in ${settingsPath}`);
	},
});
