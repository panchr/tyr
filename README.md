# tyr

> **Experimental** — tyr is under active development. The API, configuration schema, and CLI interface may change without notice.

Intelligent permission management for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) hooks. Tyr intercepts `PermissionRequest` events from Claude Code and evaluates them against your configured allow/deny patterns, so you can auto-approve safe commands and block dangerous ones without manual intervention.

Named after the [Norse god of justice](https://en.wikipedia.org/wiki/T%C3%BDr).

## How it works

Tyr registers itself as a Claude Code [hook](https://docs.anthropic.com/en/docs/claude-code/hooks) on the `PermissionRequest` event. When Claude Code asks to run a shell command, tyr:

1. Reads your Claude Code allow/deny permission patterns
2. Parses compound commands (e.g. `git add . && git commit`) and checks each component
3. Optionally asks an LLM to evaluate ambiguous commands against your patterns
4. Returns allow/deny/abstain back to Claude Code

## Why tyr?

Claude Code's `--dangerously-skip-permissions` flag gives the agent full autonomy — it can run any command without asking. That's fast, but risky: a single bad tool call can delete files, leak secrets, or break your environment with no audit trail.

Tyr gives you the same automation benefits with granular control and full observability. You choose how much autonomy to grant:

| Mode | What happens | Use case |
|------|-------------|----------|
| **Audit** (`tyr install --audit`) | Logs every permission request without evaluating it | Understand what Claude Code is doing before changing anything |
| **Shadow** (`tyr install --shadow`) | Runs the full allow/deny pipeline but always abstains to Claude Code | Validate your rules against real traffic before going live |
| **Active** (`tyr install`) | Evaluates requests and enforces allow/deny decisions | Full automation with pattern-based guardrails |

Every decision is logged to a SQLite database, so you can review what was allowed, denied, or abstained — and why.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Claude Code (for integration — tyr can be tested standalone)

## Install

```bash
# Clone and install dependencies
git clone git@github.com:panchr/tyr.git && cd tyr
bun install

# Build and install the binary to /usr/local/bin
bun run build

# Register the hook in your project (writes to .claude/settings.json)
tyr install

# Or install globally (writes to ~/.claude/settings.json)
tyr install --global
```

To remove:

```bash
tyr uninstall
tyr uninstall --global
```

Use `--dry-run` with either command to preview changes without modifying anything.

## Usage

Once installed, tyr runs automatically as a Claude Code hook. No manual invocation needed.

### Commands

```
tyr install [--global] [--project] [--dry-run] [--shadow|--audit]
tyr uninstall [--global] [--project] [--dry-run]
tyr config show
tyr config set <key> <value>
tyr config path
tyr config env set <key> <value>
tyr config env show
tyr config env path
tyr log [--last N] [--json] [--since T] [--until T] [--decision D] [--provider P] [--cwd C] [--verbose]
tyr log clear
tyr db migrate
tyr stats [--since T] [--json]
tyr suggest [--global|--project] [--min-count N] [--all]
tyr debug claude-config [--cwd C]
tyr version
```

### Configuration

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

All config values can be overridden per-invocation via CLI flags on the `judge` command (e.g. `--fail-open`, `--claude-model`). These flags are passed through the hook configuration in `.claude/settings.json`.

### Environment variables

Tyr loads environment variables from `~/.config/tyr/.env` (next to the config file). This is the recommended place to store API keys.

```bash
# Store your OpenRouter API key
tyr config env set OPENROUTER_API_KEY sk-or-...

# View stored variables (values masked)
tyr config env show

# Print .env file path
tyr config env path
```

Existing process environment variables take precedence over `.env` values.

### Providers

Tyr uses a **pipeline architecture** where providers are evaluated in sequence. The first provider to return a definitive `allow` or `deny` wins — remaining providers are skipped. If all providers `abstain`, the request falls through to Claude Code's default behavior (prompting the user), unless `failOpen` is `true`, in which case the request is approved.

Configure the pipeline via the `providers` array. **Order matters** — providers run left to right.

Valid provider names: `cache`, `chained-commands`, `claude`, `openrouter`.

#### `cache`

Caches prior decisions in SQLite. If the same command was previously allowed or denied (with the same config and permission rules), returns the cached result immediately. The cache auto-invalidates when your config or Claude Code permission rules change.

**Best practice:** Place first in the pipeline to skip expensive downstream evaluations.

#### `chained-commands`

Parses compound shell commands (`&&`, `||`, `|`, `;`, subshells, command substitution) and checks each sub-command against your Claude Code allow/deny permission patterns (merged from all settings files).

- **Allow:** All sub-commands match an allow pattern
- **Deny:** Any sub-command matches a deny pattern
- **Abstain:** Any sub-command has no matching pattern

Only evaluates `Bash` tool requests; abstains on all other tools.

#### `claude`

Sends ambiguous commands to a local Claude CLI for semantic evaluation. The LLM sees your permission rules, the command, and the working directory, then reasons about whether the command is safe.

When `claude.canDeny` is `false` (the default), the LLM can only approve commands — deny decisions are converted to abstain, forcing the user to decide. Set `canDeny: true` for stricter enforcement.

When `conversationContext` is enabled, the LLM also sees recent conversation messages from the Claude Code session. This lets it allow commands that don't match any configured pattern if the user clearly requested the action and it's a typical, safe development command. The deny list is always checked first — no amount of context overrides a denied pattern.

Requires a local `claude` CLI binary (installed with Claude Code). Timeouts and errors are treated as abstain.

Only evaluates `Bash` tool requests; abstains on all other tools.

#### `openrouter`

Sends ambiguous commands to the OpenRouter API for evaluation. Same semantics as the `claude` provider but uses an HTTP API instead of the local CLI. Supports `conversationContext` in the same way.

Requires `OPENROUTER_API_KEY` set in your environment or `.env` file.

Only evaluates `Bash` tool requests; abstains on all other tools.

#### Pipeline examples

```jsonc
// Safe & fast (default) — pattern matching only
{ "providers": ["chained-commands"] }

// With caching — faster repeated evaluations
{ "providers": ["cache", "chained-commands"] }

// Full pipeline — patterns first, then Claude for ambiguous commands
{ "providers": ["cache", "chained-commands", "claude"] }

// Using OpenRouter instead of local Claude
{ "providers": ["cache", "chained-commands", "openrouter"] }
```

### Viewing logs

Every permission decision is logged to a SQLite database at `~/.local/share/tyr/tyr.db` (overridable via `TYR_DB_PATH`).

```bash
# View recent decisions (default: last 20)
tyr log

# Show more entries
tyr log --last 50

# Filter by decision type
tyr log --decision allow
tyr log --decision deny

# Filter by time range (ISO or relative: 1h, 30m, 7d)
tyr log --since 1h
tyr log --since 2025-01-01 --until 2025-01-31

# Filter by provider or working directory
tyr log --provider chained-commands
tyr log --cwd /path/to/project

# JSON output
tyr log --json

# Show LLM prompts for verbose-logged entries
tyr log --verbose

# Clear all logs
tyr log clear
```

Log entries are automatically pruned based on the `logRetention` config setting (default: 30 days).

### Statistics

```bash
# View overall stats
tyr stats

# Stats for the last 7 days
tyr stats --since 7d

# Machine-readable JSON
tyr stats --json
```

Shows: total checks, decision breakdown (allow/deny/abstain/error), cache hit rate, provider distribution, and auto-approval count.

### Suggestions

Tyr can analyze your decision history and start an interactive Claude session to help you refine and apply allow rules:

```bash
# Start an interactive session with suggested rules (commands approved >= 5 times)
tyr suggest

# Lower the threshold for which commands are surfaced
tyr suggest --min-count 3

# Target project settings instead of global
tyr suggest --project

# Include commands from all projects, not just the current directory
tyr suggest --all
```

### Debugging

```bash
# Print the merged Claude Code permission config for the current project
tyr debug claude-config

# Print for a different project directory
tyr debug claude-config --cwd /path/to/project

# Print tyr version and runtime info
tyr version
```

### Database migrations

```bash
# Run pending schema migrations
tyr db migrate
```

## Development

```bash
bun test              # Run all tests
bun run typecheck     # Type-check without emitting
bun run lint          # Lint with Biome
```
