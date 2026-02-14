import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Settings file content shape. */
interface MockSettings {
	permissions?: {
		allow?: string[];
		deny?: string[];
	};
	[key: string]: unknown;
}

/** Write a mock Claude settings.json into a temp project directory. */
export async function writeProjectSettings(
	projectDir: string,
	settings: MockSettings,
): Promise<string> {
	const dir = join(projectDir, ".claude");
	await mkdir(dir, { recursive: true });
	const path = join(dir, "settings.json");
	await writeFile(path, JSON.stringify(settings), "utf-8");
	return path;
}

/** Write a mock Claude settings.local.json into a temp project directory. */
export async function writeLocalSettings(
	projectDir: string,
	settings: MockSettings,
): Promise<string> {
	const dir = join(projectDir, ".claude");
	await mkdir(dir, { recursive: true });
	const path = join(dir, "settings.local.json");
	await writeFile(path, JSON.stringify(settings), "utf-8");
	return path;
}

/** Write a mock user-global Claude settings.json. */
export async function writeUserSettings(
	configDir: string,
	settings: MockSettings,
): Promise<string> {
	await mkdir(configDir, { recursive: true });
	const path = join(configDir, "settings.json");
	await writeFile(path, JSON.stringify(settings), "utf-8");
	return path;
}
