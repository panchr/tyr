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
tyr install [--global] [--dry-run]    Register tyr as a Claude Code hook
tyr uninstall [--global] [--dry-run]  Remove the tyr hook
tyr config show                       Display current configuration
tyr config set <key> <value>          Update a configuration value
tyr config path                       Print the config file path
tyr log [--last N] [--tail]           View permission decision history
tyr debug claude-config               Show loaded Claude Code permissions
tyr version                           Print version
```

### Configuration

Tyr reads its own config from `~/.config/tyr/config.json` (overridable via `TYR_CONFIG_FILE`).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `allowChainedCommands` | boolean | `true` | Enable the chained-commands provider |
| `allowPromptChecks` | boolean | `false` | Enable LLM-based permission checks |
| `failOpen` | boolean | `false` | Approve on error instead of failing closed |
| `llmModel` | string | `"haiku"` | Model identifier for LLM evaluations |
| `llmTimeout` | number | `10` | LLM request timeout in seconds |

## Development

```bash
bun test              # Run all tests
bun run typecheck     # Type-check without emitting
bun run lint          # Lint with Biome
```
