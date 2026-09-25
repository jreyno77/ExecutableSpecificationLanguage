# .expec

An experimental language for readable software specifications.

The grammar and source reader are implemented. The compiler validates an initial subset of declarations, builtin types, signatures and public contracts. Full semantic validation and project generation remain unfinished.

## Development

Use Node 24.19.0 and npm 11.20.0.

```sh
npm ci
npm run check
npm run dev
```

`check` generates the parser, checks types, runs unit and BDD acceptance tests, and builds the package. `dev` watches TypeScript tests and regenerates the parser when the grammar changes. Tests use Vitest's `describe`/`it` API; fixtures live in `test/resources`.

## Package

```sh
npm run build
npm run release
```

`release` runs `npm pack`. GitHub Actions builds a package for each task PR merged into the default branch, attaches it to a GitHub Release, and records its deployment. Report incidents through GitHub Issues. npm registry publication is not configured.

Planning, language specifications and project documentation live in [Notion](https://app.notion.com/p/3e603914566581b2a671cbe2927bab48).
