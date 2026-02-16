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

async function writeSettings(
	dir: string,
	filename: string,
	settings: MockSettings,
): Promise<string> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, filename);
	await writeFile(path, JSON.stringify(settings), "utf-8");
	return path;
}

/** Write a mock Claude settings.json into a temp project directory. */
export async function writeProjectSettings(
	projectDir: string,
	settings: MockSettings,
): Promise<string> {
	return writeSettings(join(projectDir, ".claude"), "settings.json", settings);
}

/** Write a mock Claude settings.local.json into a temp project directory. */
export async function writeLocalSettings(
	projectDir: string,
	settings: MockSettings,
): Promise<string> {
	return writeSettings(
		join(projectDir, ".claude"),
		"settings.local.json",
		settings,
	);
}

/** Write a mock user-global Claude settings.json. */
export async function writeUserSettings(
	configDir: string,
	settings: MockSettings,
): Promise<string> {
	return writeSettings(configDir, "settings.json", settings);
}
