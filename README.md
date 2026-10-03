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
the existing Inspection, type catalog and `message(id)` query. Reachable source
modules are checked; external metadata supplies signatures. Queries retain
dependency origins, so consumers can distinguish entry-owned declarations.
Syntax errors, semantic errors and missing analysis remain separate. Source
composition and authored helper/check bodies remain incomplete. Compilation
does not execute expectations, discover implementations or change a project;
bodyless declarations and prose remain authored intent.

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

`Inspection.query(kind)` selects readable items; `read(id, kind?)` follows a known identity; `parent(id)` returns authored containment. Items retain source locations or external provenance. Iterators are independent. `Model` supplies indexed structural facts beneath these views; alternative models can implement the same contract.

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
