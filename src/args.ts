import type { ArgsDef } from "citty";

/**
 * Reject unknown flags in rawArgs that aren't defined in argsDef.
 * Citty parses with strict:false, so we validate manually.
 */
export function rejectUnknownArgs(rawArgs: string[], argsDef: ArgsDef): void {
	const known = new Set<string>();
	for (const [name, def] of Object.entries(argsDef)) {
		known.add(`--${name}`);
		if ("alias" in def) {
			const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
			for (const a of aliases) {
				if (a) known.add(a.length === 1 ? `-${a}` : `--${a}`);
			}
		}
	}
	// Always allow --help and --version
	known.add("--help");
	known.add("-h");
	known.add("--version");

	for (const arg of rawArgs) {
		if (!arg.startsWith("-")) continue;
		// Handle --flag=value
		const flag = arg.split("=")[0]!;
		if (!known.has(flag)) {
			console.error(`Unknown option: ${flag}`);
			process.exit(1);
		}
	}
}
