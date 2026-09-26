# .expec

An experimental language for readable software specifications.

This task defines the ANTLR grammar and a source reader. The tests accept valid syntax, reject malformed source, and preserve authored structure and source locations. Semantic validation and project generation are subsequent work.

## Inspect declarations

`inspect` creates an `Inspection` from an accepted reader result:

```ts
import { createSyntaxReader, inspect, type Inspection } from 'executable-specification-language';

const result = createSyntaxReader().read({
  sourceId: 'store.expec',
  text: 'concept StoreGame { capability saveGame() }',
});

if (result.status === 'accepted') {
  const inspection: Inspection = inspect(result.description);
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
