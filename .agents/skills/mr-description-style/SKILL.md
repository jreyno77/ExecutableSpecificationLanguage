---
name: mr-description-style
description: "Write MR descriptions/release notes in Joshwork's human voice, especially when the user says they are ready for an MR or asks for an MR description; dev-focused, concrete, with a clear Testing checklist and minimal buzzwords."
---

# MR Description Style (Joshwork)

Use this skill when drafting MR descriptions, summaries, or release notes for this repo.

## Auto-trigger intent
- If the user says they are "ready for an MR" or asks for an MR description, use this skill by default.
- Manual use is still fine and expected when requested explicitly.

## Voice and framing
- Use "this code ..." or "this change ..." (not "I").
- Avoid machine-y phrasing (e.g., "standardized") and avoid weird/overly dramatic words (e.g., "mysterious").
- Aim for a friendly dev-to-dev explanation: what changed, why it helps developers, what stayed the same.
- Keep it concise but specific; one short paragraph is ideal.

## Content expectations
- Mention the concrete improvement in developer experience (e.g., "you can tell which stage failed right away").
- Say behavior/user-facing output is unchanged if true.
- Add tests that read like examples when that is part of the change.

## Testing section
- Always include a "Testing:" section.
- Use a checklist style that mirrors the MR examples:
  - Primary test commands as top-level checkboxes.
  - Use parent items like "Verify ..." for manual flows.
  - Nest sub-steps as indented checkboxes under the parent.
- Use a mix of exact commands and short outcome notes.
- Use actual counts when available (e.g., "67 passing").

## Formatting template
Use this structure:

```
<Short title line>

<One paragraph, human voice, dev-focused>

Testing:
- [x] <command> (<result summary>)
- [x] <command> <short outcome>
- [x] Verify <manual flow>
  - [x] <step 1>
  - [x] <step 2>
```

## Example
```
Clearer CLI pack errors by stage

This code makes pack failures obvious by tagging errors to the stage they come from (setup/traverse/transform/bundle/expose). It doesn’t change behavior, it just makes the failure easier to understand, and the tests read like examples of what those errors look like.

Testing:
- [x] npm -C cli test (67 passing)
```

## Example with manual verification
```
Improve error messages for missing config

This change makes config errors point to the exact file and key that failed. It keeps the same behavior, but makes it obvious what to fix during local dev.

Testing:
- [x] npm -C cli test (67 passing)
- [x] Verify manual config failure path
  - [x] Run the CLI with a missing config file
  - [x] Confirm the error shows the file path and missing key
  - [x] Restore the config and rerun successfully
```
