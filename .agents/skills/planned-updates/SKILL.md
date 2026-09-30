---
name: planned-updates
description: Add a concise "Planned updates" section when a user asks for a change plan, per-function check-ins, or planned updates before code edits; list intended file/function changes and confirm scope before editing.
---

# Planned Updates

## Overview

Add a short "Planned updates" section before edits when the user wants a plan or check-ins, and keep it aligned with actual changes.

## Workflow

- Add a "Planned updates" section before edits when requested.
- List 1-6 bullets: `path` and (if applicable) function name plus intent; keep scope minimal.
- If the user asks for per-function check-ins, confirm the plan before editing each listed function or after the full list.
- If scope changes, stop, update the plan, and confirm before proceeding.
- In the final response, note only deviations from the plan.

## Format

Use this structure:

Planned updates
- `path/to/file.ts` `functionName` — short intent
- `path/to/file.ts` — short intent
