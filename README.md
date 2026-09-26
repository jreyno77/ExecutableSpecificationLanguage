# .expec

An experimental language for readable software specifications.

The package provides an ANTLR grammar, a source reader, typed inspection, and declaration/dependency resolution. Full type and behavior validation, compiler composition, and project generation are subsequent work.

## Inspect declarations

`DescriptionInspection` implements `Inspection` over an accepted reader result:

```ts
import { createSyntaxReader, DescriptionInspection, type Inspection } from 'executable-specification-language';

const result = createSyntaxReader().read({
  sourceId: 'store.expec',
  text: 'concept StoreGame { capability saveGame() }',
});

if (result.status === 'accepted') {
  const inspection: Inspection = new DescriptionInspection(result.description);
  const capabilities = inspection.nodes('capability');
  const names = Array.from(capabilities, node => inspection.name(node.payload.name));
  // names: ['saveGame']
} else {
  console.error(result.diagnostics);
}
```

Each iterator starts fresh, including repeated iteration of the same iterable.
Inspection exposes a deeply readonly TypeScript view of the supplied description;
keep that input unchanged and reacquire identifiers after a new read. It preserves
authored facts and locations without resolving references. Checked lookup throws
`InspectionError` with `foreign-source`, `missing-node`, or `unexpected-kind`;
these access errors are separate from reader syntax diagnostics.

## Resolve declarations

`Resolver` consumes the `Inspection` interface and a supplied dependency snapshot:

```ts
import { createSyntaxReader, DescriptionInspection, Resolver } from 'executable-specification-language';

const read = createSyntaxReader().read({
  sourceId: 'store.expec',
  text: `concept StoreGame {
  public saveGame
  capability saveGame(snapshot: Text) returns Nothing
}`,
});

if (read.status === 'accepted') {
  const resolution = new Resolver().resolve(
    new DescriptionInspection(read.description),
    { modules: [], packages: [] },
  );
  console.log([...resolution.declarations()].map(declaration => declaration.name));
  console.log(resolution.problems, resolution.deferred);
}
```

Resolution exposes declaration identities, kinds, origins and reference bindings.
Results retain no inspection provider. External modules supply data-only declaration
headers, explicit exports and required declaration links; they need no source AST.
Only explicitly imported exports enter source scope. Package entries establish
configured availability, not installation.

A report can preserve independent valid facts while also reporting problems.
Deferred references identify work requiring composition, expression or interaction
analysis; an empty problem list is not whole-compiler acceptance. Required external
links are checked for closure, not type compatibility or completeness of future
signature metadata. Query declaration identities only in their owning report, and
reacquire source identifiers after a new read.


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
