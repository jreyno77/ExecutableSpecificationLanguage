---
name: module-version-bump
description: "Bump module package versions based on branch changes vs main and update module changelogs when present."
---

# Module Version Bump (Joshwork)

Use this skill when asked to increment package versions for modules changed on the current branch compared to `main`, and to update per-module changelogs when they exist.

## Workflow
1. Determine changed files vs `main`:
   - Use `git diff --name-only main...HEAD`.
2. Map changed files to module roots:
   - Modules are top-level folders (e.g., `cli/`, `init/`, `ide/`, `ls/`, `common/`).
   - A module is considered changed if any path under it appears in the diff.
3. For each changed module:
   - Read its `package.json` to get the current version.
   - Decide bump type (patch/minor/major):
     - Default to patch.
     - If user requested a specific bump, honor it.
     - If changes are clearly breaking, ask once.
4. Increment the version:
   - Prefer `npm version <type> --no-git-tag-version` from the module root.
   - This updates `package.json` and `package-lock.json` when present.
5. Update changelog if present:
   - If `<module>/CHANGELOG.md` exists, follow its existing format.
   - Add a new entry for the new version under the most relevant section (often "Unreleased" or a new version header).
   - Keep notes brief and factual; if details are unclear, ask once for a short summary.
6. Report the modules bumped, old → new versions, and changelog updates.

## Notes
- Keep diffs minimal; do not edit unrelated modules.
- If the branch touches files outside known modules, call it out and ask how to proceed.
- If no modules changed, say so and stop.
