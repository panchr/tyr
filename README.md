# tyr

> **Experimental** — tyr is under active development. The API, configuration schema, and CLI interface may change without notice. If upgrading between minor versions, it's highly possible that a previous configuration needs some manual update.

Tyr is a CLI for intelligently managing permissions for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It is added as a hook on `PermissionRequest` events and evaluates them against configured allow/deny patterns. In the standard mode, this evaluation is done by Claude (or another LLM) by comparing the requested Bash command to the user's configuration. The hook will auto-approve commands that fuzzily match the configuration, without manual intervention.

The goal is to reduce the number of permission prompts sent to the user. As of now, Tyr only evaluates `Bash` tool requests; it abstains on all other tools.

It is named after the [Norse god of justice](https://en.wikipedia.org/wiki/T%C3%BDr).

## Why tyr?

Claude Code's `--dangerously-skip-permissions` flag gives the agent full autonomy -- it can run any command without asking. That's risky: a single bad tool call can delete files, leak secrets, or break your environment.

Tyr gives a configurable degree of autonomy to Claude:

| Mode | What happens | Use case |
|------|-------------|----------|
| **Audit** (`tyr install --audit`) | Logs every permission request without evaluating it | Understand what Claude Code is doing without performing any of tyr's logic on the request |
| **Shadow** (`tyr install --shadow`) | Runs the full allow/deny pipeline but always abstains to Claude Code | Validate your rules against real requests, before an impact |
| **Active** (`tyr install`) | Evaluates requests and enforces allow/deny decisions | Full automation with pattern-based guardrails |

Every decision is logged to a SQLite database, so you can review what was allowed, denied, or abstained — and why.

## Quickstart

Requires [Bun](https://bun.sh) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

```bash
# Install tyr
bun install -g @panchr/tyr

# Register the hook (run this inside your project directory)
tyr install

# Start a Claude Code session and work as usual — tyr runs automatically.
# When you're done, review what happened:
tyr log
tyr stats
```

That's it. Tyr evaluates every permission request against your Claude Code allow/deny patterns and logs the result. Commands that match an allowed pattern are auto-approved; everything else falls through to Claude Code's normal prompt.

To install globally (applies to all projects):

```bash
tyr install --global
```

To remove:

```bash
tyr uninstall          # project
tyr uninstall --global # global
```

Use `--dry-run` with either command to preview changes without modifying anything. Run `tyr --help` for the full command reference.

## Configuration

Tyr reads its own config from `~/.config/tyr/config.json` (overridable via `TYR_CONFIG_FILE`). The config file supports JSON with comments (JSONC).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `providers` | string[] | `["chained-commands"]` | Ordered list of providers to run |
| `failOpen` | boolean | `false` | Approve on error instead of failing closed |
| `claude.model` | string | `"haiku"` | Model identifier for the Claude CLI |
| `claude.timeout` | number | `10` | Claude request timeout in seconds |
| `claude.canDeny` | boolean | `false` | Whether Claude can deny requests |
| `openrouter.model` | string | `"anthropic/claude-3.5-haiku"` | Model for OpenRouter API |
| `openrouter.endpoint` | string | `"https://openrouter.ai/api/v1"` | OpenRouter API endpoint |
| `openrouter.timeout` | number | `10` | OpenRouter request timeout in seconds |
| `openrouter.canDeny` | boolean | `false` | Whether OpenRouter can deny requests |
| `conversationContext` | boolean | `false` | Give LLM providers recent conversation context to judge intent (can allow commands beyond configured patterns) |
| `verboseLog` | boolean | `false` | Include LLM prompt/params in log entries |
| `logRetention` | string | `"30d"` | Auto-prune logs older than this (`"0"` to disable) |

Use `tyr config show` to view the current config, `tyr config set <key> <value>` to update a value, and `tyr config schema` to print the JSON Schema.

### Environment variables

Tyr loads environment variables from `~/.config/tyr/.env` (next to the config file). This is the recommended place to store API keys (e.g., `OPENROUTER_API_KEY`). Use `tyr config env set <key> <value>` to manage them. Existing process environment variables take precedence.

## Providers

Tyr uses a **pipeline architecture** where providers are evaluated in sequence. The first provider to return a definitive `allow` or `deny` wins --- remaining providers are skipped. If all providers `abstain`, the request falls through to Claude Code's default behavior (prompting the user), unless `failOpen` is `true`, in which case the request is approved.

Configure the pipeline via the `providers` array. **Order matters** -- providers run in order.

### `cache`

Caches prior decisions in SQLite. If the same command was previously allowed or denied (with the same config and permission rules), returns the cached result immediately. The cache auto-invalidates when your config or Claude Code permission rules change.

**Best practice:** Place first in the pipeline to skip expensive downstream evaluations.

### `chained-commands`

Parses compound shell commands (`&&`, `||`, `|`, `;`, subshells, command substitution) and checks each sub-command against your Claude Code allow/deny permission patterns.

- **Allow:** All sub-commands match an allow pattern
- **Deny:** _Any_ sub-command matches a deny pattern
- **Abstain:** Any sub-command has no matching pattern

### `claude`

Sends ambiguous commands to the local Claude CLI for semantic evaluation. The LLM sees your permission rules, the command, and the working directory, then reasons about whether the command is safe.

When `claude.canDeny` is `false` (the default), the LLM can only approve commands -- deny decisions are converted to abstain, forcing the user to decide. Set `canDeny: true` for stricter enforcement.

When `conversationContext` is enabled, the LLM also sees recent conversation messages from the Claude Code session. This lets it allow commands that don't match any configured pattern if the user clearly requested the action and it's a typical, safe development command. The deny list is always checked first -- no amount of context overrides a denied pattern.

Note: this provider adds ~5 seconds of latency per evaluation due to the subprocess overhead, but this is still faster than a human reviewing and approving a command. It also reuses whatever authentication `claude` is already configured with.

### `openrouter`

Same semantics as the `claude` provider but uses the OpenRouter HTTP API instead of the local CLI. Supports `conversationContext` in the same way. Requires `OPENROUTER_API_KEY`.

### Pipeline examples

```jsonc
// Safe & fast (default) -- pattern matching only
{ "providers": ["chained-commands"] }

// With caching -- faster repeated evaluations
{ "providers": ["cache", "chained-commands"] }

// Full pipeline -- patterns first, then Claude for ambiguous commands
{ "providers": ["cache", "chained-commands", "claude"] }

// Using OpenRouter instead of local Claude
{ "providers": ["cache", "chained-commands", "openrouter"] }
```

### Permission prompt delay

When tyr is installed as a hook, Claude Code waits for the hook to return before showing the permission prompt. If the pipeline takes a few seconds (e.g., when using the `claude` or `openrouter` provider), you'll see a brief delay before the prompt appears or the command is auto-approved. This is normal — tyr is evaluating the command in the background.

## Development

```bash
bun test              # Run all tests
bun run typecheck     # Type-check without emitting
bun run lint          # Lint with Biome
```
