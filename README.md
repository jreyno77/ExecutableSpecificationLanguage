# .expec

An experimental language for readable software specifications. The compiler composes Langium reading, resolution, type descriptions and expression, fixture, scenario and communication checks over supplied inputs.

## Read project settings

```ts
import { ConfigurationReader, DependencyPlanner } from 'executable-specification-language';

const settings = new ConfigurationReader([]).read({
  sourceId: 'expec.json',
  text: `{
    "formatVersion": 1, "version": "0.2.0",
    "project": { "root": "../game" },
    "build": { "entries": ["store.expec"] }
  }`,
});
if (settings.value) {
  const dependencies = new DependencyPlanner().resolve(settings.value, { modules: [], packages: [] });
  console.log(settings.value.project, dependencies);
} else console.error(settings.problems);
```

The reader validates strict JSON and preserves authored paths. Output profiles
supplied to its constructor validate their own options. The planner checks
declared library and package ranges against host-supplied versions, returning
the compiler's existing dependency input. These operations do not read files,
install packages or change a project. Empty outputs means checking only;
an absent project remains unconnected.

## Compile a specification

```ts
import { Compiler } from 'executable-specification-language';

const result = new Compiler().compile({
  source: { sourceId: 'store.expec', text: `concept StoreGame {
  public saveGame
  capability saveGame(snapshot: Text) returns Nothing
}` },
  locator: 'store',
  dependencies: { modules: [], packages: [] },
});
if (result.value) {
  for (const capability of result.value.inspection.query('capability')) {
    console.log(capability.name, result.value.types.callable(capability.id));
  }
} else console.error(result.syntax, result.problems, result.deferred);
```

`value` exists only when static checking completes without findings. It shares
the existing Inspection, type catalog and `message(id)` query. `call(id)` returns
the checked operation identity; `step(id)` returns preceding scenario captures
and the value introduced by that step. Capture names are existing source handles
and their TypeIds belong to the same catalog. These queries retain successful
checking results without executing or rechecking source. Reachable source
modules are checked; external metadata supplies signatures. Queries retain
dependency origins, so consumers can distinguish entry-owned declarations.
Syntax errors, semantic errors and missing analysis remain separate. Extensions
and attached examples require SourceComposer. Authored test operations check ordered
locals, calls, returns and assertions through `TestOperationChecker`; their checked
calls remain available through `call(id)`. Compilation
does not execute expectations, discover implementations or change a project;
bodyless declarations and prose remain authored intent.

## Describe domain failures

```expec
type Account { id: Text }
error type AccountError {
  code: "duplicate-account" | "invalid-account"
  email: Text
}
function createAccount(email: Text) returns Account fails with AccountError
```

An error is ordinary record data with a required closed set of text codes.
`fails with` describes possible exceptional completion; it leaves the successful
result unchanged and does not infer or execute exception handling. Query
`types.callable(id).failures`, then `types.error(type)` for its declaration,
codes and existing field slots. A known error description can retain invalid or
deferred payload slots during standalone analysis; a successful compilation
has no unresolved failure prerequisites. Native exception generation is separate.

## Load configured source files

```ts
import { SourceLoader, SourceComposer, Compiler } from 'executable-specification-language';

// configuration and dependencies are successful reader/planner results.
const loaded = await new SourceLoader(absoluteManifestFilename).load(configuration, dependencies);
if (loaded.value) for (const { entry, dependencies } of loaded.value.entries) {
  const resolution = new SourceComposer(loaded.value.locate).compose(entry, dependencies);
  const compilation = new Compiler().compile({ resolution });
}
```

Entries resolve from the manifest directory; `./` and `../` imports resolve from
their owning file. Use exact `.expec` filenames. Optional `build.sourceRoots`
adds explicit directories to the default manifest-directory scope. Loading reads
only referenced files, preserves captured text/models and diagnostics on failure,
and never scans, installs or writes. Descendant links and distinct physical-file
aliases are rejected. Named libraries come from supplied dependencies; a library's
diagnostic filename does not grant it a local source root.

## Compose supplied modules

```ts
import { SourceComposer, Compiler } from 'executable-specification-language';

// entry and shared are accepted source models or supplied external models.
const resolution = new SourceComposer().compose(entry, { modules: [shared], packages: [] });
const result = new Compiler().compile({ resolution });
```

`include "shared"` exposes and re-exports shared declarations while their references
keep the original module's scope. Imports remain selective; imported aliases are
not re-exported by includes. Declarations retain their original identities and
origins. Repeated include paths are idempotent; conflicting declarations and
include cycles are diagnosed.

`extend Store { capability save() returns Nothing }` contributes original members
to Store. `examples for Store from "saving"` attaches that file's direct examples
blocks. Members keep their authoring file's imports while sharing their owner's
declarations; attached blocks keep fixtures and test operations private. Effective
parents and children preserve original handles and origins without changing inputs.
Conflicting or invalid subjects remain diagnosed; their unowned subtrees are
explicitly not analyzed. The real compiler checks the resulting combined contracts.

The default locator uses exact supplied keys. Pass a pure `(owner, authored) =>
suppliedKey | undefined` function to interpret relative locators; the owner is
always the original containing module. Composition reads no files and changes
no input models. Missing inputs remain explicit findings. The original source
Compiler entry point and Resolver retain their existing behavior.

## Inspect declarations

```ts
import { LangiumReader, LangiumModel, QueryInspection } from 'executable-specification-language';

const result = new LangiumReader().read({
  sourceId: 'store.expec',
  text: 'concept StoreGame { capability saveGame(snapshot: Text) }',
});
if (result.status === 'accepted') {
  const model = new LangiumModel('store', result.document);
  const inspection = new QueryInspection(model);
  for (const capability of inspection.query('capability')) {
    console.log(capability.name, capability.parameters.map(parameter => parameter.name));
  }
} else {
  console.error(result.diagnostics);
}
```

`Inspection.query(kind)` selects readable items; `read(id, kind?)` follows a known identity; `parent(id)` returns containment (effective ownership after composition). Items retain source locations or external provenance. Iterators are independent. `Model` supplies indexed structural facts beneath these views; alternative models can implement the same contract.

## Resolve declarations

```ts
import { ExternalModel, Resolver, QueryInspection } from 'executable-specification-language';

const library = new ExternalModel('library', [{ kind: 'opaque-type', name: 'Token' }]);
// entry is a LangiumModel whose source imports Token from "library".
const resolution = new Resolver().resolve(entry, { modules: [library], packages: [] });
const inspection = new QueryInspection(resolution.model);
for (const reference of inspection.query('reference')) {
  if (reference.resolution.status === 'bound') {
    console.log(inspection.read(reference.resolution.target));
  }
}
```

Source and external models share query and resolution contracts. Resolution returns a captured enriched model and leaves its inputs unchanged. Handles survive enrichment, but not an independent reread. Invalid external structure throws `ExternalInputError`; invalid queries throw `QueryError` with `foreign-node`, `missing-node`, `unexpected-kind`, or `not-analyzed`. Deferred references remain explicit: an empty problem list does not establish full compiler acceptance.

## Describe types and signatures

Pass the resolution above to `TypeDescriber`:

```ts
import { TypeDescriber } from 'executable-specification-language';

const catalog = new TypeDescriber().describe(resolution);
for (const declaration of catalog.callableDeclarations()) {
  const signature = catalog.callable(declaration);
  for (const parameter of signature.parameters) {
    const name = catalog.inspection.read(parameter.declaration, 'parameter').name;
    console.log(name, parameter.type); // A known type, invalid causes, or deferred prerequisites.
  }
  console.log(signature.result); // Unspecified, explicitly none, or a described value type.
}
```

The catalog exposes readable inspection and preserves original declaration handles.
`declaredType`, `typeOf`, `describe` and `fields` expose nominal identities, alias
targets and substituted generic fields. A bad slot leaves its valid neighbors
readable; opaque declarations remain distinct from empty records. Type handles
belong to one catalog. Findings are complete before queries and remain unchanged
as callers inspect recursive types. Inspect both resolution and type findings;
neither phase claims whole-program validity.

## Check expressions and contracts

```ts
import { ExpressionChecker } from 'executable-specification-language';

const checker = new ExpressionChecker(catalog);
for (const callable of catalog.inspection.query('function')) {
  const checked = checker.checkContract(callable.id);
  console.log(checked.problems, checked.deferred);
}
```

`typeOf`, `checkValue`, `checkCall`, `checkCondition`, `checkExpectation` and
`checkDefault` answer individual questions. A type result has a `value` only when
valid and complete; inspect both `problems` and `deferred`. Supplied value scopes
describe availability for that call. Defaults are checked separately from their
uses. Contracts check declared conditions without executing them or verifying
prose promises. Shared `catalog.types` owns declared and inferred type identities;
checking leaves source facts and earlier reports unchanged.
`calledOperation` identifies a call's selected declaration independently of its
argument and result validity, using the same lookup and visibility rules.

## Check reusable fixture data

```ts
import { FixtureChecker } from 'executable-specification-language';

const fixtures = new FixtureChecker(catalog, checker);
for (const fixture of catalog.inspection.query('fixture')) {
  const checked = fixtures.check(fixture.id);
  console.log(checked.value, checked.problems, checked.deferred);
}
```

A fixture returns its declared type only when its data and referenced fixtures
are valid and complete. Forward references are allowed; cycles retain their
source locations. Calls are rejected, including inside records and lists.
Required fields must be supplied explicitly even when their type declares a
default; optional fields can be absent. Checking does not materialize data or
run setup. DSL/driver discovery and test generation belong after project sync.

## Check examples and scenarios

```ts
import { ScenarioChecker } from 'executable-specification-language';

const scenarios = new ScenarioChecker(catalog.inspection, checker, fixtures);
for (const scenario of catalog.inspection.query('scenario')) {
  const checked = scenarios.check(scenario.id);
  console.log(scenario.title.value, checked.problems, checked.deferred);
}
```

`check` accepts an example or scenario identity. It checks step roles, argument
types, ordered captures and authored expectations. Captures stay local to one
scenario; invalid fixture data and failed producers retain their original causes.
An unspecified captured result remains deferred. The report contains validation
findings; original steps and expected values remain readable through Inspection.
No steps execute, and prose expectations remain verification work for generation.

## Check declared communications

```ts
import { InteractionChecker } from 'executable-specification-language';

const interactions = new InteractionChecker(catalog, checker);
for (const interaction of catalog.inspection.query('interaction')) {
  const checked = interactions.check(interaction.id);
  console.log(checked.problems, checked.deferred);
  for (const member of interaction.members) {
    if (member.kind === 'message') console.log(interactions.message(member.id));
  }
}
```

`check` validates participant types, public capabilities, arguments and ordered
replies. `message` independently returns participant and capability identities,
plus a captured reply's type when valid and complete. Inspection keeps authored
order and arguments. Duplicate names are invalid throughout the interaction;
failed producers retain their causes at later uses. An unspecified captured
result remains deferred. Dependencies and captures never invent messages.

Expression checking supplies `publicCapability` for explicitly public lookup and
`checkArguments` for shared call/message argument rules. Neither operation runs
the software; source and supplied external declarations use the same contracts.

## Read a connected project

```ts
import { ProjectConnector } from 'executable-specification-language';

// configuration is the successful ConfigurationReader result.
const connection = await new ProjectConnector(absoluteManifestPath).connect(configuration);
if (connection.value?.status === 'connected') {
  const context = connection.value.context;
  const snapshot = await context.readSnapshot();
  console.log(snapshot.files, snapshot.problems, snapshot.excludeNames);
}
```

The manifest location determines relative project paths; diagnostic source IDs do
not. Missing configuration or a missing destination returns an unconnected result
without creating anything. Each context read captures fresh bytes and SHA-256
versions while retaining earlier observations. Scans are non-atomic; completeness
reports detected gaps, not a whole-project transaction. Internal links are reported
without traversal. The default scope excludes `.git` and `node_modules`; pass
`{ excludeNames: [] }` to read those entries too. Root replacements require reconnecting.
Connection and reading never write or initialize a project.

## Apply planned file changes

```ts
import { FileProjectWriter } from 'executable-specification-language';

const basedOn = await context.readSnapshot();
const result = await new FileProjectWriter(context).apply({
  basedOn,
  changes: [{ kind: 'write', path: 'src/book.ts',
    bytes: new TextEncoder().encode('export interface Book {}\n') }],
});
console.log(result.status, result.outcomes, result.problems);
```

The writer applies complete file bytes, removals, or moves with optional replacement
bytes. It guards the whole observed scope, coordinates participating processes with
`.expec/write.lock`, and returns before/after observations when work stops partway
through. A stopped result can contain applied changes. Recover by inspecting its
receipt, reading a fresh snapshot, and explicitly proposing repairs.

Application is optimistic: it cannot atomically exclude arbitrary editor changes.
It rejects links, unsupported path aliases, overlapping operations and affected
hard links. Existing ordinary permissions are preserved; snapshots do not capture
all filesystem metadata. It never steals an existing marker or automatically rolls
back partial writes. A process killed during application may leave a marker requiring
inspection. Code ownership and preservation decisions belong to the caller's planner.

## Compare specification changes

```ts
import { SpecificationIdentity } from 'executable-specification-language';

const identities = new SpecificationIdentity(() => crypto.randomUUID());
const current = identities.associate(specification, previousBaseline);
if (current.value) {
  const changes = identities.compare(previousBaseline, current.value);
  const proposedBytes = identities.write(current.value.baseline);
  console.log(changes, proposedBytes);
}
```

`specification` is a successful Compiler result; omit `previousBaseline` on first
use. `read({ sourceId, text })` validates saved baseline JSON. Exact addresses keep
IDs; explicit `{ id, to: nodeId }` decisions establish renames/moves, and
`{ retire: id }` retires a subtree except explicitly retained descendants. Ambiguous
correspondence returns findings. Comparison reports coarse structural changes and
affected declared references; current Inspection retains the full checked facts.

`withArtifacts` records supplied exporter locators, including multiple fragments
per ID. `reconcileRelationships` compares supplied uses and preserves their scope
and coverage. These operations do not scan or edit projects. Persist proposed
baseline bytes only with successful project application. Inspection `roots()` and
`children(id)` expose complete containment alongside `query`, `read` and `parent`.

## Create and inspect output

```ts
import { Outputs, contractListOutput, structureListOutput, markdownOutput,
  FileProjectWriter } from 'executable-specification-language';

const outputs = new Outputs();
outputs.register(contractListOutput);
outputs.register(structureListOutput);
outputs.register(markdownOutput);
const output = outputs.open('contract-list', { directory: 'docs/contracts' },
  context, new FileProjectWriter(context));
if (output.value && current.value) {
  const written = await output.value.create(current.value);
  const present = await output.value.read(storeGameId);
  const uses = await output.value.search(storeGameId);
  console.log(written, present, uses);
}
```

`current.value` is the identified specification above. The summary profiles document source
declarations in the checked view, including included/imported source. External
metadata stays a reference. Markdown contract lists and structural JSON summaries
share `create`, addition-only `insert(diff, current)`, `update(diff, current)`,
`read`, `search`, and top-level `delete`. They summarize contracts; prose promises
remain unverified. This documentation scope grants no implementation-code ownership.
Error records retain their code/payload fields; declared failures are listed separately
from an operation's unchanged successful result.

For complete readable documentation, open `markdown` with `{ directory: 'docs/specification' }`.
It includes internal declarations, error contracts, fixtures, examples, operation bodies
and declared communications. Authored bodies and examples are statically checked, never
executed; prose intent remains unfinished. Linked parameter and field fragments retain
independent identities without repeated headings. Updates replace only recorded generated
regions, preserving exact prefix/notes bytes. Renames carry notes with their page; removal
with handwritten content is refused. Actual edited files remain readable and searchable.
Invalid UTF-8 prevents edits without losing the raw bytes returned by `read`.

An output keeps options and live context, captures fresh files for each operation,
and applies through the supplied writer. `plan(request, snapshot)` returns ordinary
changes without effects. Hosts can combine disjoint plans from one snapshot, then
apply them once. Successful association proposals cover only that output namespace;
retain other namespaces before calling `withArtifacts`. Outputs do not save the
global identity baseline.

Summary profiles own whole generated files. Private `.expec/outputs/` records permit
repeat operations and catch-up after skipped builds. Edited, missing, or ambiguous
owned files conflict instead of being overwritten. Read still returns their actual
complete content. Directory changes require an explicit future migration policy.
A stopped write retains actual effects/preimages and makes no successful association
proposal; inspect the receipt before planning recovery.

Search observes current Markdown definitions/CommonMark links or versioned
`*.structure.json` declaration/reference fields. It includes consumers absent from
the specification and reports incomplete coverage. It does not analyze arbitrary
code, runtime calls, or infer ownership/lifetime. Insufficient incoming-use coverage
blocks removal. Shared `ProjectRead`/`ProjectSearch` values are also usable by
independent scanners without an output registry.
Valid foreign Markdown namespaces remain project-only consumers and targets; their
opaque identities never become definitions owned by the selected output.

Custom outputs register an ordinary `{ id, validate, open }` object. `open(options)`
returns an `OutputAdapter` with pure `plan`, `read`, and `search` operations over a
supplied snapshot. `ProjectOutput` supplies live capture, result validation, and
guarded application. No decorators, package loading, or inheritance are required.

## TypeScript project queries

```ts
import { TypeScriptProject } from 'executable-specification-language';

const reader = new TypeScriptProject({ outputId: 'typescript', configFile: 'tsconfig.json' }, [
  { specId: storeGameId, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: {
    file: 'src/store.ts', declaration: [{ kind: 'class', name: 'StoreGame' }],
  } } },
]);
const snapshot = await connectedProject.readSnapshot();
const source = reader.read(storeGameId, snapshot);
const relationships = reader.search(storeGameId, snapshot);
```

Read returns whole original files, including private state and handwritten bodies.
Search follows native TypeScript symbols, aliases, overloads and members, retaining
unmodeled consumers. Both return the shared `ProjectRead`/`ProjectSearch` values.
Exact lexical selectors survive body edits; a renamed or moved declaration needs
an explicit new association. Class members specify `static: true` or `false`.
Explicit constructor parameter properties belong to the class; constructor facets
remain separate from class type/value uses. `typescript-file-1` companions return
raw bytes without claiming their declarations as owned symbols.

Every query analyzes its supplied capture. Source, configuration and packages come
only from captured bytes; the sole disk resource is the pinned TypeScript standard
library. Without `configFile`, the profile is ES2022/NodeNext, strict, JSX Preserve,
no automatic type packages, and legacy module detection (plain scripts can merge).
Native JSONC configuration overrides that profile; plugins/project references stay
explicitly unsupported. Definitions and uses carry original UTF-16 offsets and file
versions. Dynamic lookup, native diagnostics and missing inputs make coverage
incomplete. The reader neither reconnects files nor authorizes or performs writes.

## Initialize a chosen project

```ts
import { ProjectInitializer } from 'executable-specification-language';

const initializer = new ProjectInitializer(manifestLocation, configuration);
const preview = await initializer.prepare({ root: '../store-game', target: 'typescript' });
if (preview.value) {
  // Present the destination and exact file bytes before accepting.
  const result = await initializer.apply(preview.value, authorAccepted);
  if (result.value) useProject(result.value.context, result.value.configuration);
}
```

The TypeScript starter contains package.json, tsconfig.json, src/index.ts and
.gitignore. It requires an absent leaf below an existing parent or an empty ordinary
directory. Declining creates nothing; changed destinations stop application.
Initialization neither installs dependencies nor generates contracts/tests or runs
the build. The host explicitly saves the returned configuration when appropriate.
After supplying pinned TypeScript 5.9.3, `npm run build` compiles the starter.
A stopped result preserves any created root and actual writer receipt; inspect it
before recovery. Accepted previews are single-use, including failed attempts.
## Development and delivery

Use Node 24.19.0 and npm 11.20.0.

```sh
npm ci
npm run check
npm run test:package
npm run dev
```

`check` generates the AST/parser services, checks types, runs unit and acceptance tests, and builds. `dev` generates once and starts Vitest watch. After editing `src/langium/Expec.langium`, run `npm run grammar:generate`; generated files are ignored. Tests use `test/acceptance`, `test/dsl`, `test/driver`, `test/unit`, and fixtures in `test/resources`.

`test/acceptance` contains domain scenarios; `test/unit` checks focused component contracts.
`test/dsl` provides domain actions and expectations; `test/driver` invokes the real APIs
and returns observations. Drivers contain no test assertions or expected answers.

`test:package` builds and packs once, then installs the tarball into isolated consumers.
It checks public runtime and TypeScript imports and detects missing files/dependencies.
This separate suite runs in Windows/Linux CI and may need registry access; install
scripts are disabled. Declaration checks use `strict`, `exactOptionalPropertyTypes`
and `skipLibCheck: true`; compatibility with `skipLibCheck: false` is not established.

`npm run build` builds; `npm run release` runs `npm pack`. GitHub Actions creates a verified package, release and deployment record for each merged task PR. Incidents use GitHub Issues. npm publication, full type/behavior validation and project generation remain subsequent work.

Planning and detailed specifications live in [Notion](https://app.notion.com/p/3e603914566581b2a671cbe2927bab48).
