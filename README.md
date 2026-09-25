# .expec — Executable Specification Language

A language idea for describing software concepts, contracts, dependencies, and expected behavior in readable shorthand, then generating project scaffolds, executable specifications, and diagrams for selected targets.

The central requirement is that specifications can evolve without losing handwritten implementation code.

Repository: [ExecutableSpecificationLanguage](https://github.com/jreyno77/ExecutableSpecificationLanguage).

The project manifest defines the connected software project, target languages/output formats, dependencies, version, and build settings. Builds use that configuration to apply changes directly to the connected project's source and files. If no project is connected, the tool asks whether to initialize one.

Specifications should compose across files, including separate examples and shared declarations. An extensible output API should support code, tests, diagrams, Markdown, and additional formats. Syntax and architecture sketches remain candidates for discussion.

Output instances receive configured options and a live project-context component. Their `read` operation retrieves a concept's complete current representation; `search` discovers its definition, uses, and actual dependencies throughout the project, including code absent from the specification.

Current status: **18 construction tasks, 11 user stories, and 78 acceptance-scenario definitions: 34 earlier EX, 19 grammar GR, and 25 compiler CV scenarios.** CORE-01 and CORE-18 are **Implementing**, with Ready specification baselines and **Inconclusive** full-scope hypotheses. The remaining 16 tasks are **Captured** and **Untested**. An initial TypeScript reader/compiler and real acceptance bindings now run: 8 definitions are bound, 2 partially bound, and 68 unbound. Target generation, connected-project updates, and self-hosting remain unimplemented. See the [scoped implementation evidence](docs/implementation-evidence.md).

Development follows a learning loop: broad need → pitch and proposed pieces → stories → substantial construction tasks → detailed and executable specifications → generation when supported → design and implementation → evidence and learning → revision of the board, stories, and pitch. The first task is **CORE-01 — Define the .expec language grammar**, covering the full current language scope. Detailed architecture and implementation steps emerge while specifying and building each task. Task bodies contain only **Hypothesis**, **Test list**, and **Learnings**; story links use relations and detailed specifications stay separate. Confirmed needs define the outcome; each proposed solution still needs evidence.

- [Notion project, learning board, and setup record](docs/notion-project.md)
- [Ordered plan for the 18 construction tasks](docs/build-plan.md)
- [Development workflow, task template, and evidence conventions](docs/development-workflow.md)
- [User stories for building .expec with .expec](docs/stories.md)
- [Concrete examples and the path to executable specifications](specifications/README.md)
- [CORE-01 grammar specification, proposed contracts, and acceptance cases](specifications/grammar/README.md)
- [CORE-18 compiler and validation specification](specifications/compiler/README.md)
- [Compiler acceptance scenarios](specifications/acceptance/compiler.feature)
- [Run and develop the compiler](docs/development.md)
- [Implementation evidence and unfinished coverage](docs/implementation-evidence.md)
- [Delivery, incidents, and metrics](docs/delivery.md)
- [Generating readable acceptance tests and their supporting DSL](docs/acceptance-generation.md)
- [Multi-file specifications and extensible outputs](docs/modularity-and-exports.md)
- [Historical compiler self-description sketch](specifications/draft/compiler.expec)
- [Earlier output API and live project context sketch](specifications/draft/output.expec)
- [Language vision and initial checkpoint](docs/checkpoints/2026-09-24-language-vision.md)
- [Original Store Game implementation supplied as a preservation reference](examples/store-game/original-implementation.ts)

The checkpoint separates confirmed user requirements, observations from the supplied recordings, proposed design directions, and unresolved decisions. Every reference must resolve to a declaration available in scope, locally, elsewhere in the project, or through a dependency. Referencing `saveGame` when only `save` is declared must fail compilation.

The original design artifacts remain distinct from implementation evidence. Bound acceptance tests invoke the real compiler and independently observe its results. The [coverage inventory](specifications/acceptance/coverage.json) documents authored examples across tasks; only current CORE-18 work appears as test TODOs. Future work belongs in its stories and tasks, while existing regression tests remain. Learning should revise the proposal when necessary, without hiding failed checks or treating passing examples as proof beyond their scope.

The current compiler boundary is `Compiler.compile(CompilationInput)` with separate source reading and semantic validation. Earlier EX examples and draft `.expec` files preserve discovery history, not the current API. Relationships are derived from dependencies, construction/capability signatures, outputs, and fields; ordered interactions remain explicit.
