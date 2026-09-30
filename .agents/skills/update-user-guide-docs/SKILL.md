---
name: update-user-guide-docs
description: Update KALM IDE user-guide documentation from code-backed research. Use when Codex needs to revise ide/UserGuide.md, refresh docs for current KALM IDE capabilities, add simple non-technical user-facing instructions, coordinate section research with agents when explicitly authorized, add recommended screenshot/image insertion comments, or report which features are missing or intentionally left undocumented.
---

# Update User Guide Docs

## Core Rule

Document only behavior supported by the codebase or by explicit user-provided release instructions. Keep the user guide simple enough for non-technical users.

Prefer clear steps, exact command labels, and short explanations. Avoid implementation details in the guide body unless they help a user choose the right action.

## Workflow

1. Read the current request, `ide/UserGuide.md`, and relevant open files.
2. Form a docs-sized hypothesis: which guide sections are stale or missing, and what code should prove the replacement text.
3. Research before editing. Use `rg` first and cite local code evidence in notes/final, not in the user-facing guide.
4. Use subagents only when the user explicitly asks for agents, delegation, or parallel research. Give each agent a narrow section and ask for code references plus doc-ready wording.
5. Plan the guide update by section. Keep old unsupported content out, and leave unknown areas brief when they cannot be proven.
6. Patch `ide/UserGuide.md`.
7. Add recommended image insertions as Markdown comments, not visible rendered text:

```md
<!-- Recommended image insert: VS Code Extensions view with "Install from VSIX..." highlighted. -->
```

8. Validate the guide for ASCII, exact command labels, stale old terminology, and unsupported claims.
9. Report changed sections, validation, tests not run for docs-only changes, and any features found but not fully documented.

## Research Map

Use focused searches instead of rereading the whole repo.

- Installation and activation: `ide/package.json`, `ide/src/vscode/extension.ts`, `ide/src/core/cliDownloader.ts`, `ide/src/vscode/requirements.ts`.
- KALM Init: `init/package.json`, `init/src/main.ts`, `init/src/init/**`.
- Project layout and local resolution: `ide/src/core/environment.ts`, `ide/src/core/ioSearchAdapter.ts`, `ide/src/core/resolution/localResolutionApi.ts`, `init/src/init/stages/stub.ts`.
- Connections and context: `ide/src/webview/client/Sidebar.tsx`, `ide/src/webview/client/ConnectionPanel.tsx`, `ide/src/webview/sideBar.ts`, `ide/src/vscode/connectionManager.ts`, `ide/src/core/execution/build/executionContext.ts`.
- CQL execution/results/options: `ide/package.json`, `ide/src/vscode/cqlLanguageClient.ts`, `ide/src/core/cql/buildParameters.ts`, `ide/src/core/execution/**`, `ide/src/webview/client/ResultsViewer.tsx`, `ide/src/webview/client/CqlResultsViewPanel.tsx`.
- Measure execution/results: `ide/src/vscode/measureScanner.ts`, `ide/src/core/measure/buildMeasureParameters.ts`, `ide/src/core/execution/execute/executeMeasure.ts`, `ide/src/webview/client/ResultsViewer.tsx`, `ide/src/webview/client/MeasureResultsViewPanel.tsx`.
- Packaging and publishing: `ide/src/core/publishCommands.ts`, `ide/src/core/publishPipeline.ts`, `cli/package.json`, `init/src/init/stages/package-json.ts`.
- Dependency viewers and semantic navigation: `ide/package.json`, `ide/src/webview/dependency-viewer/**`, `ide/src/vscode/extension.ts`.

## Image Insert Guidance

Use comments immediately after the section they support. Recommend screenshots for:

- VSIX install flow.
- Package registry download.
- KALM Init terminal run and generated Explorer tree.
- Project folder layout.
- CQL highlighting/diagnostics/hover.
- Current Context sidebar.
- Connection form and test connection.
- Override Default Context and HEDIS settings.
- CQL right-click execution menu.
- CQL results viewer.
- Local patient data folder.
- Measures sidebar and Measure results viewer.
- Terminology folders.
- Pack/publish commands and configuration.
- Project, CQL, and Expression Dependency Viewers.
- Semantic navigation hover.
- Open Logs and Cql To Graph commands.

Do not add broken Markdown image links unless the actual image files exist. Use comments until screenshots are available.

## User-Facing Style

- Write for users who are not technical.
- Prefer numbered steps for actions.
- Use exact labels from `package.json` or the UI code.
- Use short paragraphs.
- Keep warnings concrete, especially for exported connection credentials and remote all-patient context behavior.
- Do not expose internal class names, function names, or line references in `UserGuide.md`.
- Keep old project structure notes only when the code still supports compatibility.

## Validation

Run lightweight checks after editing:

```sh
LC_ALL=C grep -n '[^ -~]' ide/UserGuide.md
rg -n "TODO|stub|compatability|localy|Pack Project Tarball|Install from Marketplace|input/cql|input/tests" ide/UserGuide.md
rg -n "Recommended image insert" ide/UserGuide.md
```

Compare command labels against `ide/package.json` before finalizing.

For docs-only changes, module tests are usually unnecessary. State that tests were not run because the change was documentation-only. If source code changes are made, follow the repo test gates.

## Security Story

Maintain a small concern -> defense -> evidence note while working:

- Concern: docs may cause accidental credential exposure.
- Defense: warn that connection export may include credentials.
- Evidence: connection import/export and credential storage code.

- Concern: docs may cause broad remote execution.
- Defense: explain that remote no-context fallback is opt-in through Override Default Context.
- Evidence: settings and connection context resolution code.
