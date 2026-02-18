# Claude Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Project Overview

Tyr is a Claude Code hook for intelligent permission management. Key areas:

- `src/commands/` — CLI commands (install, config, judge, log, stats, suggest, etc.)
- `src/providers/` — Pipeline providers (cache, chained-commands, claude, openrouter)
- `src/agents/` — Agent integrations (Claude Code settings parsing)
- `src/config.ts` — Config file reading/writing (JSONC support)
- `src/types.ts` — Zod schemas, provider interface, config types
- `src/db.ts` — SQLite database, schema migrations
- `src/log.ts` — Decision logging and retention
- `src/__tests__/` — All tests (unit and E2E)

## Backwards Compatibility

Tyr is pre-v1. Do not add backwards-compatibility shims, migration code, or legacy fallbacks for config formats, log formats, or CLI flags. If the user has an outdated config, tyr should error with a clear message rather than silently migrating.

## Testing

- **Always add tests** when making code changes. Every bug fix needs a regression test.
- Unit tests go alongside the code they test in `src/__tests__/`.
- E2E tests spawn `tyr` as a subprocess with isolated config/DB (see existing patterns in `judge.test.ts`, `cache.test.ts`).
- Use `saveEnv()` from `src/__tests__/helpers/` to isolate environment variables.
- Use `TYR_DB_PATH`, `TYR_CONFIG_FILE`, and `CLAUDE_CONFIG_DIR` env vars to isolate test state.
- Tests that spawn subprocesses should set a `{ timeout: 10_000 }` or similar.
- The 11 OpenRouter E2E failures (`EADDRINUSE` on `Bun.serve`) are a known sandbox limitation — they pass outside the sandbox.

## Documentation

- **Keep README.md up to date** when changing user-facing behavior: CLI flags, config keys, providers, commands.
- The config table in README.md must match `TyrConfigSchema` in `src/types.ts`.
- The commands listing in README.md must match the subcommands registered in `src/index.ts`.

## Dev Workflow

After every task, follow this workflow in order:

1. **Make code changes**
2. **Add tests** if needed
3. **Run `bun lint`** — fix any issues before proceeding
4. **Run `bun test`** — fix any issues before proceeding
5. **Run `code-reviewer` agent** — fix any issues before proceeding. Group changed files by language and invoke the agent separately for each group (e.g., `.ts` files and `.sh` files get separate reviews in parallel)
6. **Commit and close beads issue** (if there is one) — see commit rules below

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git commit` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run dev workflow above** (if code changed)
3. **Update issue status** - Close finished work, update in-progress items
4. **Clean up** - Clear stashes
5. **Verify** - All changes committed
6. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- **After finishing any task, immediately commit and close it** — do not wait for the user to remind you. The sequence is: run quality gates → `bd close <id>` → `bd sync --from-main` → `git add` (include `.beads/issues.jsonl`) → `git commit`. This is not optional.
- Work is NOT complete until `bd` is updated AND `git commit` succeeds
- NEVER use `bd sync` (use `bd sync --from-main` on ephemeral branches)
- When committing a task, always include `.beads/issues.jsonl` in the same commit so beads state stays in sync with the code changes.
- Only close a task once the work has been committed
