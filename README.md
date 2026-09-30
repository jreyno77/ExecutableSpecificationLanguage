# .expec

An experimental language for readable software specifications.

The package provides an ANTLR grammar, a source reader, typed inspection, and declaration/dependency resolution. Full type and behavior validation, compiler composition, and project generation are subsequent work.

## Inspect declarations

`DescriptionInspection` captures an accepted reader result at an explicit module locator:

```ts
import { createSyntaxReader, DescriptionInspection, type Inspection } from 'executable-specification-language';

const result = createSyntaxReader().read({
  sourceId: 'store.expec',
  text: 'concept StoreGame { capability saveGame() }',
});

if (result.status === 'accepted') {
  const inspection: Inspection = new DescriptionInspection('store', result.description);
  const capabilities = inspection.nodes('capability');
  const names = Array.from(capabilities, node => inspection.name(node.payload.name));
  // names: ['saveGame']
} else {
  console.error(result.diagnostics);
}
```

Each iterator starts fresh, including repeated iteration of the same iterable.
Inspection captures a readonly snapshot with opaque node handles. It preserves
authored facts and source locations without resolving references. `ExternalInspection`
adapts an authored library contract into the same nodes, with external data paths
as provenance. Invalid external structure throws `InspectionInputError`.

## Resolve declarations

`Resolver` enriches a module inspection with reference outcomes. Both input producers
use the same query and resolution operations:

```ts
import { createSyntaxReader, DescriptionInspection, ExternalInspection, Resolver } from 'executable-specification-language';

const shopping = new ExternalInspection('shopping', [
  { kind: 'record-type', name: 'Cart', fields: [
    { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
  ] },
]);

const read = createSyntaxReader().read({
  sourceId: 'store.expec',
  text: 'use Cart as Basket from "shopping"\nfunction save(cart: Basket)',
});

if (read.status === 'accepted') {
  const store = new DescriptionInspection('store', read.description);
  const resolved = new Resolver().resolve(store, { modules: [shopping], packages: [] });
  for (const reference of resolved.nodes('reference')) {
    console.log(resolved.reference(reference.id)); // Preserves Cart or Basket spelling.
    const outcome = reference.payload.resolution;
    if (outcome.status === 'bound') {
      const declaration = resolved.node(outcome.target); // Actual declaration and children.
      console.log(declaration.payload.kind, declaration.origin);
    }
  }
  console.log(resolved.problems, resolved.deferred);
}
```

Original inspections stay unchanged. Reacquire a reference by its original handle
from the resolved view to read its `bound`, `invalid` or `deferred` outcome. The view
contains the entry, reached modules and builtins; queries do not call input providers.
Aliases share declaration identity, and a missing field type does not erase its record.
Supplying a module does not import its names. Package configuration checks availability
and requested phases, without performing installation.

Checked lookup throws `InspectionError`: `foreign-node`, `missing-node`,
`unexpected-kind`, or `not-analyzed` for a supplied but unreached module. Handles
survive into derived resolution views, but not an independent reread. Deferred
references identify composition, expression or interaction work still required;
an empty problem list does not establish whole-compiler acceptance.


## Development

Use Node 24.19.0 and npm 11.20.0.

```sh
npm ci
npm run check
npm run dev
```

`check` generates the parser, checks types, runs unit and BDD acceptance tests, and builds the package. `dev` generates the parser once and starts Vitest's watch mode. After editing `src/grammar/Expec.g4`, run `npm run grammar:generate` to regenerate the TypeScript parser; Vitest watches the generated code. Tests use Vitest's `describe`/`it` API; fixtures live in `test/resources`.

## Package

```sh
npm run build
npm run release
```

`release` runs `npm pack`. GitHub Actions builds a package for each task PR merged into the default branch, attaches it to a GitHub Release, and records its deployment. Report incidents through GitHub Issues. npm registry publication is not configured.

Planning, language specifications and project documentation live in [Notion](https://app.notion.com/p/3e603914566581b2a671cbe2927bab48).
