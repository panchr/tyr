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

## Code Review

After making code changes, **always** run the `code-reviewer` agent before committing. Group changed files by language and invoke the agent separately for each group.

Example: if you changed `.ts` files and a `.sh` file, run two review agents in parallel — one for the TypeScript files and one for the shell file.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git commit` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
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
