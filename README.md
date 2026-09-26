# .expec

An experimental language for readable software specifications.

The ANTLR reader accepts syntax, rejects malformed source, and preserves authored structure and locations. Visitors let independent consumers collect facts from the same description. Semantic validation and project generation are subsequent work.

## Visit source

```typescript
import { createSyntaxReader, visit } from 'executable-specification-language';

const read = createSyntaxReader().read({
  sourceId: 'game.expec',
  text: 'concept StoreGame { capability save() returns Nothing }',
});

if (read.status === 'accepted') {
  const names: string[] = [];
  visit(read.description, {
    capability(node, context) {
      names.push(context.name(node.payload.name));
    },
  });
}
```

`Visitor<K>` is one typed callback; `Visitors` registers callbacks by kind. `visit` delivers matching nodes synchronously in the reader's source order, including nested declarations. Callers own their results; a thrown callback error propagates and stops that visit.

`VisitorContext` reads nodes by identifier, decodes names and returns ordered reference segments. `node(id, kind)` also checks the expected kind. Invalid access throws `VisitError` with `code` and `nodeId`; wrong-kind errors include `expectedKind` and `actualKind`.

Views are deeply readonly to TypeScript callers; keep the input snapshot stable while visiting. IDs are local to a read and cannot distinguish revisions with the same source ID. Source references remain unresolved. Visiting performs no I/O or scenario execution.

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
