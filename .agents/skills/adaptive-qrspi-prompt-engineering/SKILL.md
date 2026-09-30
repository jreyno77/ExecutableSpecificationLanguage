---
name: adaptive-qrspi-prompt-engineering
description: Turn vague asks into right-sized, high-signal prompts with an adaptive QR-S-P-I workflow. Use when the user wants an initial prompt for a new task, a stronger starting prompt from a generic ask, an ultra-compact packet for a tiny ask, or a compact prompt packet instead of a full plan.
---

# Adaptive QR-S-P-I Prompt Engineering

## Overview

Turn a generic ask into the smallest prompt that will still give the next agent enough structure to do good work. Default to QR-S-P-I alignment, but collapse stages aggressively whenever the task is tiny, already scoped, or low risk.

## Stage Selection

- Ultra-compact: one obvious change, short context, and low risk.
- Standard: meaningful ambiguity, but not a broad or risky change.
- Wide: cross-cutting, architecture-sensitive, or likely to need deeper review.

Use the smallest path that fits:

- Ultra-compact: final prompt only, or one blocking question if absolutely necessary.
- Standard: Questions -> Research -> Design -> Structure -> Plan -> Prompt.
- Wide: full staged flow, with separate markdown artifacts when that reduces slop.

## Rules

- Do not force every stage.
- Only ask for a checkpoint when it materially reduces risk or rework.
- For ultra-compact tasks, skip research, design, and structure unless a missing fact would change the prompt.
- Keep each stage prompt under about 40 instructions.
- Research is factual only. No implementation bias.
- Design states the desired end state, patterns to follow, anti-patterns, and unresolved questions.
- Structure is the header file: phases, signatures, types, and handoffs.
- Plan is tactical and short. Do not produce a huge plan for a tiny task.
- If the user already supplied enough context, skip straight to the prompt.
- If the task is tiny, collapse Research and Design unless they add real value.

## Output Contract

Return, in order:

- The best prompt to use next.
- Assumptions, only when they matter.
- Missing details or questions, only when blocking.
- A compact version if the user asked for speed.
- An ultra-compact version when the task is tiny and low risk.
- An expanded version only when the task is wide or risky.

The final deliverable should be copy-pasteable as a prompt packet, not a prose summary of the workflow.

## Reference

See [qrspi workflow reference](references/qrspi.md) for the stage templates and collapse rules.
