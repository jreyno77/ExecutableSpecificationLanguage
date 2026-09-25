# Developing .expec

Use Node **24.19.0** and npm **11.20.0**, then run:

```sh
npm ci
npm run dev
```

The development command generates the parser and starts Vitest in watch mode. TypeScript edits trigger the relevant tests. Editing `grammar/Expec.g4` stops tests, regenerates the parser, then restarts the watcher. If generation fails, tests remain stopped until a grammar edit fixes the error; old generated code must not produce a misleading green result. `npm run test:watch` is the lighter option when only editing TypeScript.

Write the next unit or acceptance example for the current task first, run it and observe the expected failure, then implement the behavior and repeat. Acceptance tests use the public compiler API; unit tests isolate syntax, semantic rules, delivery guards, and metrics. TODOs are restricted to the active CORE-18 compiler task; future work stays in its stories and tasks. Existing regression tests remain. A passing run does not complete CORE-18 while its acceptance TODOs remain.

```sh
npm run test:unit
npm run test:acceptance
npm run typecheck
npm run build
npm run check
```

`check` regenerates the parser, typechecks, runs unit and acceptance tests, and emits the package into `dist`. CI runs that same command after a locked install on Ubuntu and Windows. It does not allow an empty test suite to pass. Generated parser files and build artifacts are ignored; a clean checkout regenerates them from the committed grammar.

The implementation uses [antlr-ng](https://www.antlr-ng.org/getting-started.html) to generate TypeScript without installing Java, with the [antlr4ng runtime](https://www.npmjs.com/package/antlr4ng). The generator is pinned to 1.0.10 and runtime to 3.0.16. The TypeScript grammar adapter keeps generated parser classes out of the public source model. [Vitest](https://vitest.dev/guide/) and TypeScript versions are pinned in the manifest and lockfile. This toolchain is an implementation choice, not a language requirement.

The package is ESM and exposes its compiled public API through the package root. `createCompiler()` creates the default compiler and `createSyntaxReader()` creates the syntax reader. Compilation returns accepted specifications or explicit diagnostics; it does not run the described software or install project dependencies. See the compiler acceptance suite and implementation scope in the project documentation for current support.

## Delivery checks

Each task PR merged into the repository's default branch triggers `.github/workflows/release.yml`. The workflow builds from an archive of the exact merge commit in a temporary directory, executes `check`, packs a version such as `0.1.0-pr.2`, and installs that tarball in an isolated consumer. The smoke test imports the package root and checks an accepted declaration and an unresolved-reference rejection. The connected source checkout is unchanged. There is no npm registry publication.

The workflow creates one release tag `pr-N`, attaches the artifact, downloads and verifies its SHA-256, then records a successful GitHub deployment. A specification-only bootstrap commit instead produces a ZIP in the separate `specification-delivery` environment. Its delivery is excluded from compiler package metrics. See [delivery evidence and metrics](delivery.md) for the agreed deployment boundary and incident records.

Reruns validate the existing tag and evidence and retain the original deployment timestamp. An interrupted upload in GitHub's `starter` state can be recreated; an already uploaded artifact with a different digest is an error. If the artifact was delivered but uploading `delivery.json` failed, rerunning repairs its evidence without creating another delivery. GitHub's [release asset API](https://docs.github.com/en/rest/releases/assets) and [deployment status API](https://docs.github.com/en/rest/deployments/statuses) provide the verification and timestamps. API behavior is covered locally with failure-path tests; live workflow execution is only verified after an actual authorized merge.

For a local delivery build on Windows, set `EXPEC_NPM_CLI` to the pinned npm installation's `bin/npm-cli.js` and ensure Node 24 is on `PATH`. The helper requires a clean Git checkout; it only builds an artifact and runs smoke checks when called directly. GitHub writes are performed by the separate delivery orchestrator with the workflow token.
