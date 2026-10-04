# .expec

Write readable software contracts and examples, then build them into a connected project.
.expec checks names, types and scenarios; outputs create and update code, Markdown,
diagrams and acceptance tests while preserving confirmed handwritten implementations.
It is experimental. Prose promises become visible verification obligations.

## Try a complete example

Use Node 24.19.0 and npm 11.20.0. Download the package `.tgz` from
[GitHub Releases](https://github.com/jreyno77/ExecutableSpecificationLanguage/releases).
In an empty working directory, run `npm init -y`, then `npm install` followed by
the downloaded file's path. Packages are delivered as release assets; npm publication is future work.

Run the installed command without a registry lookup:

```sh
node node_modules/executable-specification-language/dist/cli-entry.js --help
node node_modules/executable-specification-language/dist/cli-entry.js --version
```

Save these two files beside your package.json.

**main.expec**

<!-- expec-example: shopping/main.expec -->
```expec
examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then expectBookQuantity("Dune", 1)
  }
}
```

**expec.json**

<!-- expec-example: shopping/expec.json -->
```json
{
  "formatVersion": 1,
  "version": "0.1.0",
  "build": { "entries": ["main.expec"] },
  "outputs": [
    { "id": "acceptance", "options": { "domain": "shopping", "configFile": "tsconfig.json" } }
  ],
  "packages": [
    { "alias": "tests", "name": "npm:vitest", "version": "5.0.2", "phases": ["test"] },
    { "alias": "node", "name": "npm:@types/node", "version": "24.13.6", "phases": ["test"] }
  ]
}
```

Initialize the connection, then explicitly install its declared requirements.
These commands run from the directory containing expec.json; initialization records
`./game` as the connected project.

```sh
node node_modules/executable-specification-language/dist/cli-entry.js init --root ./game --target typescript --yes
node node_modules/executable-specification-language/dist/cli-entry.js install
```

Include both application and test files in **game/tsconfig.json**:

<!-- expec-example: shopping/game/tsconfig.json -->
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Check the specification and generate its test layers:

```sh
node node_modules/executable-specification-language/dist/cli-entry.js check
node node_modules/executable-specification-language/dist/cli-entry.js build
```

Open `game/test/acceptance/shopping.test.ts`. Its test reads like the scenario:

```ts
await shopping.bookIsAvailable("Dune");
await shopping.startWithEmptyBasket();
await shopping.addBook("Dune");
await shopping.expectBookQuantity("Dune", 1);
```

The generated `test/dsl` layer holds the check and delegates runtime operations to
`test/driver`. Driver stubs throw until implemented. Give this example a real
in-memory application by adding **game/src/basket.ts**:

<!-- expec-example: shopping/game/src/basket.ts -->
```ts
export class Basket {
  private readonly available = new Set<string>();
  private readonly contents = new Map<string, number>();
  offer(title: string): void { this.available.add(title); }
  empty(): void { this.contents.clear(); }
  add(title: string): void {
    if (!this.available.has(title)) throw Error("Book is unavailable");
    this.contents.set(title, this.quantity(title) + 1);
  }
  quantity(title: string): number { return this.contents.get(title) ?? 0; }
}
```

Implement **game/test/driver/shopping.ts**, retaining the generated public signatures:

<!-- expec-example: shopping/game/test/driver/shopping.ts -->
```ts
import { Basket } from "../../src/basket.js";

export class ShoppingDriver {
  private readonly basket = new Basket();
  async bookIsAvailable(title: string): Promise<void> { this.basket.offer(title); }
  async startWithEmptyBasket(): Promise<void> { this.basket.empty(); }
  async addBook(title: string): Promise<void> { this.basket.add(title); }
  async bookQuantity(title: string): Promise<number> { return this.basket.quantity(title); }
}
```

Now run the actual generated test:

```sh
node node_modules/executable-specification-language/dist/cli-entry.js test
```

Remove the `contents.set` line in Basket.add and the same test must fail: it
expects one Dune and observes zero. Restore the line and rerun. Handwritten
implementation edits can be tested directly. After changing .expec, run build
before test; test never silently regenerates your assertions.

## Revise or connect an existing project

Paths in expec.json resolve from that file. `--config path/to/expec.json` selects
another manifest. `project.root` records the connected directory; declared
`packages`, `libraries` and output options describe its requirements.

Build preserves established identities and mapped implementations. An ambiguous
rename requests a deliberate decision. `build --decisions changes.json` accepts:

```json
{
  "format": 1,
  "matches": [
    { "id": "the-existing-subject-id", "to": { "source": "main.expec", "line": 1, "column": 1 } }
  ],
  "retire": []
}
```

Use the actual established subject ID and new declaration location. A retirement
does not authorize destroying handwritten code. Resolve reported conflicts and
inspect partial write receipts before retrying.

Existing handwritten layouts use the public library API with explicit native
mappings and a host-owned baseline. `SpecificationIdentity.read/write/withArtifacts`
preserve those associations; `Outputs.open(...).read(id)` reads the current
subject and `search(id)` returns definitions, uses and honest coverage.
The CLI's private ledger is not an adoption API.
[The StoreGame pilot](https://app.notion.com/p/3ee039145665816e80c2d3261981224e)
shows the complete adoption and revision contract.

## Compose source through the public API

```ts
import { Compiler, SourceComposer, SourceLoader } from "executable-specification-language";

// configuration and dependencies are successful ConfigurationReader / DependencyPlanner results.
const loaded = await new SourceLoader(absoluteManifestFilename).load(configuration, dependencies);
if (loaded.value) {
  const resolution = new SourceComposer(loaded.value.locate).compose(loaded.value.entries);
  const compiled = new Compiler().compile({ resolution });
  if (compiled.value) {
    for (const capability of compiled.value.inspection.query("capability"))
      console.log(capability.name, compiled.value.types.callable(capability.id));
  } else console.error(compiled.syntax, compiled.problems, compiled.deferred);
}
```

Compose the workspace once, including all entries. Imported shared declarations
retain their identities and scopes. Built-in Text, Number, Boolean, List and
Nothing need no imports. Other names must be declared or imported.
Compilation checks supplied descriptions; it does not install dependencies,
scan a project or execute scenarios.

## Add an output

In an ES module project (`"type": "module"` in package.json), copy the delivered
`node_modules/executable-specification-language/test/resources/package-consumer/signatures-output.ts`
into your project. This small example supports primitive function signatures in
NDJSON, preserves authored note records, and searches only its declared format.
It reports unsupported language features and malformed or competing definitions.
Compile it with your project's TypeScript compiler:

```sh
node node_modules/typescript/bin/tsc signatures-output.ts --module NodeNext --target ES2022 --strict --skipLibCheck
```

A custom launcher (`expec.mjs`) supplies that ordinary `OutputRegistration`:

```ts
import { runCli } from "executable-specification-language";
import { signaturesOutput } from "./signatures-output.js";

process.exitCode = await runCli(process.argv.slice(2), {
  contracts: [signaturesOutput]
});
```

Select `{ "id": "signatures", "options": { "destination": "contracts.ndjson" } }`
in expec.json's outputs, then run `node expec.mjs build`. Keep its established
identities when revising signatures; the sample refuses unowned replacement and
deletion. Its complete source is intentionally a consumer module you can change.

An output validates its options and opens an adapter over a current project
capture. The adapter plans changes and answers current read/search queries;
the supplied writer applies guarded changes. Unsupported facts and incomplete
coverage stay explicit. Configuration never imports executable plugins.
[Output contracts](https://app.notion.com/p/3e60391456658112887cd63b6e55c679)
and [installed exporter examples](https://app.notion.com/p/3ef0391456658144a2d0ccb9b3cfc098)
describe that boundary.

## Commands and delivery

- `init` creates an explicitly chosen project connection; declining changes nothing.
- `install` acquires declared tools/packages explicitly.
- `check` validates current source and prerequisites.
- `build` synchronizes contracts, then refreshes the project before generating tests.
- `test` verifies current generated identities and executes their native tests.

Use `--json` for one format-1 result on stdout; application logs go to stderr.
Exit codes: 0 success, 1 invalid/failed work, 2 usage, 3 an author decision,
130 cancellation. A missing implementation or prose verification obligation
is unfinished work, not a passing test.

TypeScript uses 5.9.3 and Vitest 5.0.2. Markdown and UML document checked
contracts and explicitly authored communication; references do not establish
ownership, lifetime or runtime calls. Native target prerequisites are documented
with each delivered profile. IDE support and npm publication are future work.

For contributors: `npm ci`, `npm run check`, `npm run test:package`.
`npm run build` generates the Langium model and builds the package;
`npm run release` packs it. GitHub Actions owns versioned artifacts, releases
and deployment records. Incidents are GitHub Issues.
