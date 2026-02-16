export {
	MALFORMED_REQUEST,
	makeNonBashRequest,
	makePermissionRequest,
	makeWrongEventRequest,
} from "./fixtures.ts";
export {
	writeLocalSettings,
	writeProjectSettings,
	writeUserSettings,
} from "./settings.ts";
export type { CliResult } from "./subprocess.ts";
export { runCli, runJudge } from "./subprocess.ts";

/**
 * Save an environment variable's current value and return a restore function.
 * Call the returned function in afterEach to restore the original state.
 */
export function saveEnv(name: string): () => void {
	const saved = process.env[name];
	return () => {
		if (saved === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = saved;
		}
	};
}
