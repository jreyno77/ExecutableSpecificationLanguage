# .expec

An experimental language for readable software specifications. The package reads `.expec` with Langium, exposes typed queries, resolves declarations and dependencies, and describes types and callable contracts.

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

`Inspection` has two operations: `query(kind)` selects readable items; `read(id, kind?)` follows a known identity. Items retain source locations or external provenance. Iterators are independent. `Model` supplies indexed structural facts beneath these views; alternative models can implement the same contract.

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

const types = new TypeDescriber().describe(resolution);
for (const declaration of types.callableDeclarations()) {
  const signature = types.callable(declaration);
  for (const parameter of signature.parameters) {
    const name = types.inspection.read(parameter.declaration, 'parameter').name;
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

## Development and delivery

Use Node 24.19.0 and npm 11.20.0.

```sh
npm ci
npm run check
npm run dev
```

`check` generates the AST/parser services, checks types, runs unit and acceptance tests, and builds. `dev` generates once and starts Vitest watch. After editing `src/langium/Expec.langium`, run `npm run grammar:generate`; generated files are ignored. Tests use `test/acceptance`, `test/dsl`, `test/driver`, `test/unit`, and fixtures in `test/resources`.

`test/acceptance` contains domain scenarios; `test/unit` checks focused component contracts.
`test/dsl` provides domain actions and expectations; `test/driver` invokes the real APIs
and returns observations. Drivers contain no test assertions or expected answers.

`npm run build` builds; `npm run release` runs `npm pack`. GitHub Actions creates a verified package, release and deployment record for each merged task PR. Incidents use GitHub Issues. npm publication, full type/behavior validation and project generation remain subsequent work.

Planning and detailed specifications live in [Notion](https://app.notion.com/p/3e603914566581b2a671cbe2927bab48).
