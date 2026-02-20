import { readFile } from "node:fs/promises";

export interface TranscriptMessage {
	role: "user" | "assistant";
	content: string;
}

/** Content block within an assistant message. */
interface ContentBlock {
	type: string;
	text?: string;
}

/** Shape of a single JSONL line in the transcript file. */
interface TranscriptLine {
	type: string;
	isSidechain?: boolean;
	isMeta?: boolean;
	message?: {
		role?: string;
		content?: string | ContentBlock[];
	};
}

/** Read the last N conversation messages from a Claude transcript JSONL file.
 *  Returns an empty array on any error (graceful degradation). */
export async function readTranscript(
	path: string,
	maxMessages: number,
): Promise<TranscriptMessage[]> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch {
		return [];
	}

	const messages: TranscriptMessage[] = [];

	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let entry: TranscriptLine;
		try {
			entry = JSON.parse(trimmed) as TranscriptLine;
		} catch {
			continue;
		}

		// Skip non-conversation entries
		if (entry.type !== "user" && entry.type !== "assistant") continue;
		if (entry.isSidechain || entry.isMeta) continue;
		if (!entry.message) continue;

		if (entry.type === "user") {
			if (typeof entry.message.content !== "string") continue;
			messages.push({ role: "user", content: entry.message.content });
		} else {
			// Assistant: extract text content blocks
			const content = entry.message.content;
			if (!Array.isArray(content)) continue;
			const textParts = content
				.filter(
					(block): block is ContentBlock & { text: string } =>
						block.type === "text" && typeof block.text === "string",
				)
				.map((block) => block.text);
			if (textParts.length === 0) continue;
			messages.push({ role: "assistant", content: textParts.join("\n") });
		}
	}

	return messages.slice(-maxMessages);
}

const DEFAULT_MAX_CHARS = 500;

/** Format transcript messages for inclusion in an LLM prompt.
 *  Each message is truncated to maxCharsPerMessage characters.
 *  Returns an empty string if there are no messages. */
export function formatTranscriptForPrompt(
	messages: TranscriptMessage[],
	maxCharsPerMessage: number = DEFAULT_MAX_CHARS,
): string {
	if (messages.length === 0) return "";

	const lines = messages.map((msg) => {
		const truncated =
			msg.content.length > maxCharsPerMessage
				? `${msg.content.slice(0, maxCharsPerMessage)}...`
				: msg.content;
		return `[${msg.role}]: ${truncated}`;
	});

	return lines.join("\n");
}
