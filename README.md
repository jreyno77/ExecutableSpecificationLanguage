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

## Run the same example in Java, Kotlin or Python

Start in a fresh directory, install the same release artifact as above, and copy the same **main.expec** shopping example. Save this **expec.json** instead of the TypeScript configuration:

<!-- expec-example: native-shopping/expec.json -->
```json
{
  "formatVersion": 1,
  "version": "0.1.0",
  "build": { "entries": ["main.expec"] },
  "outputs": []
}
```

Choose one native profile for this project. Java and Kotlin require an ordinary installed JDK 21 directory. Python requires ordinary CPython 3.12 and uv 0.12.23 executables. Substitute their actual absolute paths below, preserving quotes around paths with spaces. On Windows these may be `"C:\Tools\jdk-21"`, `"C:\Tools\Python312\python.exe"` and `"C:\Tools\uv\uv.exe"`; on Unix use the corresponding absolute native paths. Linked installation layouts may need an ordinary extracted toolchain directory. Initialization records the chosen tools; it does not install them.

<details>
<summary>Java</summary>

```sh
node node_modules/executable-specification-language/dist/cli-entry.js init --root ./game --target java --java-home "/absolute/path/to/jdk-21" --yes
node node_modules/executable-specification-language/dist/cli-entry.js install
node node_modules/executable-specification-language/dist/cli-entry.js check
node node_modules/executable-specification-language/dist/cli-entry.js build
```

The starter selects Java contracts and `java-acceptance`. Explicit installation acquires locked Gradle 9.1.0 and JUnit 6.1.3 dependencies, including the ordinary Console/reporting modules. Add **game/src/main/java/generated/Basket.java**:

<!-- expec-example: java-shopping/game/src/main/java/generated/Basket.java -->
```java
package generated;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class Basket {
    private final Set<String> available = new HashSet<>();
    private final Map<String, Double> contents = new HashMap<>();
    public void offer(String title) { available.add(title); }
    public void empty() { contents.clear(); }
    public void add(String title) {
        if (!available.contains(title)) throw new IllegalStateException("Book is unavailable");
        contents.put(title, quantity(title) + 1.0);
    }
    public double quantity(String title) { return contents.getOrDefault(title, 0.0); }
}
```

Implement the generated **game/src/test/java/generated/tests/driver/ShoppingDriver.java**, retaining its public signatures:

<!-- expec-example: java-shopping/game/src/test/java/generated/tests/driver/ShoppingDriver.java -->
```java
package generated.tests.driver;

import generated.Basket;

public class ShoppingDriver {
    private final Basket basket = new Basket();
    public void bookIsAvailable(String title) { basket.offer(title); }
    public void startWithEmptyBasket() { basket.empty(); }
    public void addBook(String title) { basket.add(title); }
    public double bookQuantity(String title) { return basket.quantity(title); }
}
```

</details>

<details>
<summary>Kotlin</summary>

```sh
node node_modules/executable-specification-language/dist/cli-entry.js init --root ./game --target kotlin --java-home "/absolute/path/to/jdk-21" --yes
```

Kotlin initialization selects its contract output. Append the following object to the existing `outputs` array in **expec.json**, retaining the starter's other fields and Kotlin entry:

<!-- expec-example: kotlin-shopping/acceptance-output.json -->
```json
{ "id": "kotlin-acceptance", "options": { "package": "generated.tests", "domain": "shopping" } }
```

```sh
node node_modules/executable-specification-language/dist/cli-entry.js install
node node_modules/executable-specification-language/dist/cli-entry.js check
node node_modules/executable-specification-language/dist/cli-entry.js build
```

Explicit installation acquires Gradle 9.1.0, Kotlin 2.4.10 and JUnit 6.1.3. Add **game/src/main/kotlin/generated/Basket.kt**:

<!-- expec-example: kotlin-shopping/game/src/main/kotlin/generated/Basket.kt -->
```kotlin
package generated

class Basket {
    private val available = mutableSetOf<String>()
    private val contents = mutableMapOf<String, Double>()
    fun offer(title: String) { available.add(title) }
    fun empty() { contents.clear() }
    fun add(title: String) {
        check(title in available) { "Book is unavailable" }
        contents[title] = quantity(title) + 1.0
    }
    fun quantity(title: String): Double = contents[title] ?: 0.0
}
```

Implement **game/src/test/kotlin/generated/tests/driver/ShoppingDriver.kt**. Keep the generated open class/methods and zero-argument construction:

<!-- expec-example: kotlin-shopping/game/src/test/kotlin/generated/tests/driver/ShoppingDriver.kt -->
```kotlin
package generated.tests.driver

import generated.Basket

open class ShoppingDriver {
    private val basket = Basket()
    open fun bookIsAvailable(title: String): Unit { basket.offer(title) }
    open fun startWithEmptyBasket(): Unit { basket.empty() }
    open fun addBook(title: String): Unit { basket.add(title) }
    open fun bookQuantity(title: String): Double = basket.quantity(title)
}
```

</details>

<details>
<summary>Python</summary>

```sh
node node_modules/executable-specification-language/dist/cli-entry.js init --root ./game --target python --python "/absolute/path/to/python3.12" --uv "/absolute/path/to/uv" --yes
node node_modules/executable-specification-language/dist/cli-entry.js install
node node_modules/executable-specification-language/dist/cli-entry.js check
node node_modules/executable-specification-language/dist/cli-entry.js build
```

The starter selects Python contracts and acceptance tests. Explicit installation creates the project environment with LibCST 1.9.0, Jedi 0.20.0, mypy 2.4.0 and pytest 9.1.1. `expec.python.json` records source/test roots and tool paths; changes to native configuration or requirements need another explicit install. `install --offline` uses available cached packages and fails when a required package is missing. Additional requirements use `pypi:` names and exact two- or three-part release versions.

Native inspection uses captured source and dependencies. Dynamic or unresolved uses limit coverage and preserving edits; compiled application extensions require compatible stubs. The public `PythonContext`, `PythonProject.read/search`, `pythonOutput` and `pythonAcceptanceOutput` APIs compose these operations.

Add **game/src/basket.py**:

<!-- expec-example: python-shopping/game/src/basket.py -->
```python
class Basket:
    def __init__(self) -> None:
        self.available: set[str] = set()
        self.contents: dict[str, float] = {}

    def offer(self, title: str) -> None:
        self.available.add(title)

    def empty(self) -> None:
        self.contents.clear()

    def add(self, title: str) -> None:
        if title not in self.available:
            raise ValueError("Book is unavailable")
        self.contents[title] = self.quantity(title) + 1.0

    def quantity(self, title: str) -> float:
        return self.contents.get(title, 0.0)
```

Implement **game/test/driver/shopping_driver.py**:

<!-- expec-example: python-shopping/game/test/driver/shopping_driver.py -->
```python
from basket import Basket

class ShoppingDriver:
    def __init__(self) -> None:
        self.basket = Basket()

    def bookIsAvailable(self, title: str) -> None:
        self.basket.offer(title)

    def startWithEmptyBasket(self) -> None:
        self.basket.empty()

    def addBook(self, title: str) -> None:
        self.basket.add(title)

    def bookQuantity(self, title: str) -> float:
        return self.basket.quantity(title)
```


</details>

### Observe the same behavior

For the selected profile, run:

```sh
node node_modules/executable-specification-language/dist/cli-entry.js test
```

The generated scenario must pass with one Dune in the basket. Remove only the quantity assignment in Basket.add (`contents.put`, `contents[title] =`, or `self.contents[title] =` above), keeping its availability check. The same test must fail with expected 1 and actual 0. Restore that line and test again. No build occurs between these runs: the generated assertions and DSL stay unchanged. The driver obtains quantity from the actual application state.

Generated stubs remain unfinished until implemented. Build and native inspection do not execute application code. Missing, skipped, failed or unfinished current generated cases cannot establish test success. Native build/read/test never installs missing dependencies implicitly. This starter uses one executable target per connected project; documentation outputs can coexist. The Python command follows its controlled pytest profile, not every arbitrary plugin/configuration. A directly invoked new Unix Gradle wrapper uses `sh gradlew`, because file creation alone does not promise an executable mode; the documented CLI commands handle native invocation.

## Revise or connect an existing project

Paths in expec.json resolve from that file. `--config path/to/expec.json` selects
another manifest. `project.root` records the connected directory; declared
`packages`, `libraries` and output options describe its requirements.

Build preserves established identities and mapped implementations. An ambiguous
rename requests a deliberate decision. Run `build --json` and copy the ID from
the `identity-correspondence` message for the previous declaration. That
diagnostic's location refers to the previous source, before your edit.
`build --decisions changes.json` accepts:

```json
{
  "format": 1,
  "matches": [
    { "id": "the-existing-subject-id", "to": { "source": "main.expec", "line": 1, "column": 1 } }
  ],
  "retire": []
}
```

Use that ID and the new declaration's starting line/column (both start at 1). A retirement
does not authorize destroying handwritten code. Resolve reported conflicts and
inspect partial write receipts before retrying.

When contracts succeed but acceptance generation stops, `build` retains the original
specification transition for the unfinished stage. Repair the reported handwritten
implementation and retry the same command. Default names follow the retained rename;
explicit mappings and handwritten code keep their existing protections. A different
specification, configuration, project identity or captured dependency requires resolving
the reported recovery conflict first. `test` will not execute an unfinished build.
Older stopped builds without retained transition evidence do not gain invented history.
Do not edit the private identity or recovery records.

Existing handwritten layouts use the public library API with explicit native
mappings and a host-owned baseline. `SpecificationIdentity.read/write/withArtifacts`
preserve those associations; `Outputs.open(...).read(id)` reads the current
subject and `search(id)` returns definitions, uses and honest coverage.
The CLI's private ledger is not an adoption API.
The shipped `test/resources/package-consumer/adopt-store-game.mjs` is a concrete
recipe you can copy and edit. It expects an authored StoreGame class with
`save(snapshot: Text) returns Nothing`, mapped explicitly to
`StoreGame.save(snapshot: string): void` in the connected `src/game.ts`.
Supply expec.json with that source entry and project root, plus the project's
tsconfig.json. This local-source example has no external library/package requirements.

```js
import { adoptStoreGame, readStoreGame } from "./adopt-store-game.mjs";
const adopted = await adoptStoreGame("./expec.json", "./author.identity.json");
console.log(adopted.written);
const current = await readStoreGame("./expec.json", "./author.identity.json");
console.log(current.read, current.search);
```

Keep author.identity.json outside the connected project. It records confirmed
associations through the public API; native files remain the source of current
implementation and usage facts. [The StoreGame pilot](https://app.notion.com/p/3ee039145665816e80c2d3261981224e)
describes the adoption and revision contract.

## Compose source through the public API

```ts
import { buildWorkspace } from "./workspace-build.mjs";
const { current, written } = await buildWorkspace("./expec.json", "./author.identity.json");
console.log(written);
for (const capability of current.specification.inspection.query("capability"))
  console.log(capability.name, current.specification.types.callable(capability.id));
```

Copy `workspace-build.mjs` from the installed package's
`test/resources/package-consumer` directory. Provide a connected TypeScript
project with package.json (`"type": "module"`) and a tsconfig.json including
its source files. The local-source recipe accepts this manifest:

```json
{
  "formatVersion": 1,
  "version": "0.1.0",
  "project": { "root": "./project" },
  "build": { "entries": ["game.expec", "checkout.expec"] },
  "outputs": [{ "id": "typescript", "options": { "directory": "src", "configFile": "tsconfig.json" } }]
}
```

Both source files can import `Book` from a shared `book.expec`. The recipe
composes all entries once and then generates their contracts. External dependencies
require an explicit acquisition step when you extend this local-source example.
After a confirmed write, it saves the public baseline outside the project;
a failed baseline save does not undo already applied native writes.
Imported shared declarations
retain their identities and scopes. Built-in Text, Number, Boolean, List and
Nothing need no imports. Other names must be declared or imported.
Compilation checks supplied descriptions; it does not install dependencies,
scan a project or execute scenarios.

## Generate documentation

In another empty working directory, install the same artifact and create an
empty `game` directory. Save **main.expec** and **expec.json**:

<!-- expec-example: store-design/main.expec -->
```expec
type PlayerStateSnapshot { shoppingCart: Text }
concept StoreGame {
  public save
  capability save(snapshot: PlayerStateSnapshot) returns Nothing
}
```

<!-- expec-example: store-design/expec.json -->
```json
{
  "formatVersion": 1,
  "version": "0.1.0",
  "build": { "entries": ["main.expec"] },
  "project": { "root": "./game" },
  "outputs": [
    { "id": "markdown", "options": { "directory": "docs" } },
    { "id": "uml", "options": { "directory": "design", "views": ["structure"] } }
  ]
}
```

Run `node node_modules/executable-specification-language/dist/cli-entry.js build`.
Read `game/docs/StoreGame.md` and open `game/design/structure.svg`; the editable
diagram source is beside it. The input points toward its consumer, StoreGame.
These documents describe checked contracts; they do not prove runtime behavior,
ownership or lifetime. Explicit communication scenarios can supply sequence views.

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

Contributors use Node 24.19.0, npm 11.20.0 and JDK 21 through `JAVA_HOME`.
Run `npm ci`, `npm run check` and `npm run test:package`.
`npm run build` generates the Langium model, builds the Java/Kotlin bridges,
stages the Python resources and bundles the installed command;
`npm run release` packs it. GitHub Actions owns versioned artifacts, releases
and deployment records. Incidents are GitHub Issues.

`npm run test:java` and `npm run test:kotlin` run the native suites;
`npm run test:java-package` and `npm run test:kotlin-package` check installed consumers.
For these tests, supply an ordinary JDK 21 directory as `EXPEC_TEST_JAVA_HOME`
and the verified JUnit Console Standalone 6.1.3 fixture as `EXPEC_TEST_JUNIT_CONSOLE`
(SHA-256 `e62b96ac475dbcde8599ea905d088f65d90778f86e259b856a49fa5c4ea256ec`).
The installed CLI uses the connected project's acquired dependencies.

After editing `src/language/langium/Expec.langium`, run `npm run grammar:generate`;
generated files are ignored.
