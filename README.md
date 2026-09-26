# .expec

An experimental language for readable software specifications.

The ANTLR source reader accepts syntax, rejects malformed source, and preserves authored structure and locations. Typed inspection lets independent consumers collect facts from the same description. Semantic validation and project generation are subsequent work.

## Inspect source

```typescript
import { createSyntaxReader, inspectSource } from 'executable-specification-language';

const read = createSyntaxReader().read({
  sourceId: 'game.expec',
  text: 'concept StoreGame { capability save() returns Nothing }',
});

if (read.status === 'accepted') {
  const source = inspectSource(read.description);
  const capabilities = [...source.nodes('capability')].map(node => ({
    name: source.name(node.payload.name),
    location: node.range,
  }));
}
```

`nodes(kind)` returns a fresh iterable in authored depth-first order. Views are deeply readonly to TypeScript callers; keep the original snapshot stable while inspecting it. IDs are local to that snapshot, not persistent across edits. `name(id)` decodes a name, `reference(id)` returns decoded name segments, and `node(id, kind)` checks an ID and narrows its payload. Invalid lookups throw `SourceInspectionError`.

These are authored source facts. References remain unresolved; inspection does not load files, execute scenarios, or infer runtime relationships.

## Development

Use Node 24.19.0 and npm 11.20.0.

```sh
npm ci
npm run check
npm run dev
```

`check` generates the parser, checks types, runs unit and BDD acceptance tests, and builds the package. `dev` generates the parser once and starts Vitest's watch mode. After editing `src/grammar/Expec.g4`, run `npm run grammar:generate` to regenerate the TypeScript parser; Vitest watches the generated code. Tests use Vitest's `describe`/`it` API; fixtures live in `test/resources`.

The inspection comparison keeps its callback alternative in `test/resources/inspection`; only the selected query API is exported by the package. The [contract and experiment results](https://app.notion.com/p/3e70391456658139b630fc046ee35802) record the decision and its limits.

## Package

```sh
npm run build
npm run release
```

`release` runs `npm pack`. GitHub Actions builds a package for each task PR merged into the default branch, attaches it to a GitHub Release, and records its deployment. Report incidents through GitHub Issues. npm registry publication is not configured.

Planning, language specifications and project documentation live in [Notion](https://app.notion.com/p/3e603914566581b2a671cbe2927bab48).
