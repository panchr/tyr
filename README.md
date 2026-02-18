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

Every decision is logged to a SQLite database at `~/.local/share/tyr/tyr.db` (or `$TYR_DB_PATH`), so you can review what was allowed, denied, or abstained — and why.

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

## Usage

Once installed, tyr runs automatically as a Claude Code hook. No manual invocation needed.

### Commands

```
tyr install [--global] [--dry-run] [--shadow|--audit]
tyr uninstall [--global] [--dry-run]
tyr config show
tyr config set <key> <value>
tyr config path
tyr config env set <key> <value>
tyr config env show
tyr log [--last N] [--json] [--since T] [--until T] [--decision D] [--provider P] [--cwd C] [--verbose]
tyr log clear
tyr db migrate
tyr stats [--since T] [--json]
tyr suggest [--apply] [--global|--project] [--min-count N] [--json]
tyr debug claude-config
tyr version
```

### Configuration

Tyr reads its own config from `~/.config/tyr/config.json` (overridable via `TYR_CONFIG_FILE`).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `providers` | string[] | `["chained-commands"]` | Ordered list of providers to run (`cache`, `chained-commands`, `llm`) |
| `failOpen` | boolean | `false` | Approve on error instead of failing closed |
| `llm.provider` | string | `"claude"` | LLM backend: `claude` or `openrouter` |
| `llm.model` | string | `"haiku"` | Model identifier for LLM evaluations |
| `llm.timeout` | number | `10` | LLM request timeout in seconds |
| `llm.canDeny` | boolean | `false` | Whether the LLM provider can deny requests |
| `verboseLog` | boolean | `false` | Include LLM prompt and parameters in log entries |
| `logRetention` | string | `"30d"` | Auto-prune log entries older than this (`"0"` to disable) |

All config values can be overridden per-invocation via CLI flags (e.g. `--fail-open`, `--llm-model`). The config file supports JSON with comments (JSONC).

### Providers

Tyr uses a **pipeline architecture** where providers are evaluated in sequence. The first provider to return a definitive `allow` or `deny` wins — remaining providers are skipped. If all providers `abstain`, the request falls through to Claude Code's default behavior (prompting the user), unless `failOpen: true` is set.

Configure the pipeline via the `providers` array. **Order matters** — providers run left to right.

#### `cache`

Caches prior decisions in SQLite. If the same command was previously allowed or denied (with the same config and permission rules), returns the cached result immediately. The cache auto-invalidates when your config or Claude Code permission rules change.

**Best practice:** Place first in the pipeline to skip expensive downstream evaluations.

#### `chained-commands`

Parses compound shell commands (`&&`, `||`, `|`, `;`, subshells, command substitution) and checks each sub-command against Claude Code's allow/deny permission patterns from `.claude/settings.json`.

- **Allow:** All sub-commands match an allow pattern
- **Deny:** Any sub-command matches a deny pattern
- **Abstain:** Any sub-command has no matching pattern

Only evaluates `Bash` tool requests; abstains on all other tools.

#### `llm`

Sends ambiguous commands to an LLM for evaluation. The LLM sees your permission rules, the command, and the working directory, then reasons about whether the command is safe.

When `llm.canDeny` is `false` (the default), the LLM can only approve commands — deny decisions are converted to abstain, forcing the user to decide. Set `canDeny: true` for stricter enforcement.

Requires either a local Claude CLI (`llm.provider: "claude"`) or an OpenRouter API key (`llm.provider: "openrouter"` + `OPENROUTER_API_KEY` env var).

Only evaluates `Bash` tool requests; abstains on all other tools. Timeouts and errors are treated as abstain.

#### Pipeline examples

```jsonc
// Safe & fast (default) — pattern matching only
{ "providers": ["chained-commands"] }

// With caching — faster repeated evaluations
{ "providers": ["cache", "chained-commands"] }

// Full pipeline — patterns first, then LLM for ambiguous commands
{ "providers": ["cache", "chained-commands", "llm"] }
```

## Development

```bash
bun test              # Run all tests
bun run typecheck     # Type-check without emitting
bun run lint          # Lint with Biome
```
