# Contributing to insights-mcp

Thanks for helping improve the project! This guide covers the basics to get you productive quickly.

## Quick start
1. Install Node.js 18+.
2. Install deps: `npm install`.
3. Build once to verify: `npm run build`.

## Development workflow
- Use `npm run dev` for watch mode while iterating.
- Run `npm test` (currently placeholder) and `npm run build` before opening a PR.
- Keep code TypeScript-strict and prefer small, focused changes.

## Issue tracking
- All work is tracked with **bd (beads)**. Create/claim/update issues via `bd` commands rather than TODO lists.
- Large efforts should be broken into an epic with subtasks.

## Coding guidelines
- ES2022 modules, strict TypeScript.
- Add concise comments only where intent isn’t obvious.
- Maintain consistent formatting enforced by tsc; no additional lints currently configured.

## Commits & releases
- Follow Conventional Commits (e.g., `feat: ...`, `fix: ...`).
- Include the required footer in commits:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

## Testing matrix
- Primary target: Node 20 (works on 18+).
- Minimum smoke tests: `npm test` and `npm run build`.

## Submitting changes
1. Fork or branch from `main`.
2. Implement and add/adjust tests as needed.
3. Update docs when behavior changes (README, AGENTS/CLAUDE instructions).
4. Open a PR referencing relevant beads issue IDs.

Thank you for contributing! Every small improvement helps keep Claude sessions more capable.
