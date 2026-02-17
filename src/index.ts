#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import config from "./commands/config.ts";
import debug from "./commands/debug.ts";
import install from "./commands/install.ts";
import judge from "./commands/judge.ts";
import log from "./commands/log.ts";
import uninstall from "./commands/uninstall.ts";
import version from "./commands/version.ts";
import { VERSION } from "./version.ts";

const main = defineCommand({
	meta: {
		name: "tyr",
		version: VERSION,
		description: "Intelligent permission management for Claude Code hooks",
	},
	subCommands: {
		config,
		debug,
		install,
		judge,
		log,
		uninstall,
		version,
	},
});

runMain(main);
