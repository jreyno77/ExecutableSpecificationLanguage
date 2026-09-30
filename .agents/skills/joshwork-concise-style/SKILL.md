---
name: joshwork-concise-style
description: "Concise coding standard for Joshwork: minimize line count and intermediate variables, use direct variable names, and compress obvious steps without sacrificing type safety or clarity. Use when writing or refactoring code, especially in the kalm-ide repo or when the user asks for shorter, tighter code or condensed formatting."
---

# Joshwork Concise Style

## Overview
Write code in the smallest, clearest form. Favor direct variable names, remove single-use intermediates, and compress obvious steps while keeping type safety and clarity intact.

## Core rules
1. Use the fewest lines that remain readable and type-safe.
2. Prefer direct, digestible names; avoid stacked prefixes like raw/lower/normalized.
3. Collapse single-use variables into expressions or a single helper.
4. For simple, linear transforms, prefer a single expression chain with one fallback; let the formatter wrap it.
5. Prefer existing recursion over creating new helper functions when it already expresses the flow clearly.
6. When logic spans multiple steps, ask the user(josh) about extracting a tiny helper with a precise name.
7. Prefer one-pass construction and handler maps over multi-pass or long switches.
8. Do not trade correctness or clarity for brevity.
9. Keep the smallest diff possible: do not reflow or re-indent unchanged blocks, and avoid touching whitespace unless required by the change.

## Refactor checklist
- Replace variable ladders with a compact expression.
- Inline simple normalization pipelines (basename -> lower -> replace) when used once.
- Keep a single fallback at the end; remove redundant fallbacks.
- Prefer existing recursive flow before introducing new helper functions.
- Use `??` / `||` for defaults.
- Ask about using a small parsing helper for repeated normalization, only when applicable.
- Keep spacing tight and remove vertical padding.

## Example
Before:
```ts
const rawDirName = path.basename(projectRoot) || fallbackProjectName;
const lowerDirName = rawDirName.toLowerCase();
const normalizedDirName = lowerDirName.replace(/[^a-z0-9-]+/g, "-");
const safeDirName = normalizedDirName || fallbackProjectName;
const defaultProjectName = `example.${safeDirName}`;
```

After:
```ts
const safeDirName =
  path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "content-project";
const defaultProjectName = `example.${safeDirName}`;
```
