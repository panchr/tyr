import type { ArgsDef } from "citty";

/** Parse a relative time string like '1h', '30m', '2d' into a Date, or parse ISO. */
export function parseTime(value: string): Date | null {
	const relativeMatch = value.match(/^(\d+)([smhd])$/);
	if (relativeMatch) {
		const amount = Number(relativeMatch[1]);
		const unit = relativeMatch[2];
		const multipliers: Record<string, number> = {
			s: 1000,
			m: 60_000,
			h: 3_600_000,
			d: 86_400_000,
		};
		const ms = multipliers[unit as string];
		if (ms === undefined) return null;
		return new Date(Date.now() - amount * ms);
	}
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reject unknown flags in rawArgs that aren't defined in argsDef.
 * Citty parses with strict:false, so we validate manually.
 */
export function rejectUnknownArgs(rawArgs: string[], argsDef: ArgsDef): void {
	const known = new Set<string>();
	for (const [name, def] of Object.entries(argsDef)) {
		known.add(`--${name}`);
		if ("type" in def && def.type === "boolean") {
			known.add(`--no-${name}`);
		}
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
		const flag = arg.split("=")[0] ?? arg;
		if (!known.has(flag)) {
			console.error(`Unknown option: ${flag}`);
			process.exit(1);
		}
	}
}
