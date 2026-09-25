import fs from "node:fs";
import { expect } from "vitest";
import { createCompiler } from "../../src/index.js";

export type Compiler = ReturnType<typeof createCompiler>;
export type CompilationInput = Parameters<Compiler["compile"]>[0];
export type CompilationResult = ReturnType<Compiler["compile"]>;
export type Accepted = Extract<CompilationResult, { status: "accepted" }>;
export type Specification = Accepted["specification"];
export type Symbol = Specification["symbols"][number];
export type TypeId = Specification["types"][number]["id"];
export type Catalog = CompilationInput["dependencies"];
export type CompileOperation = (input: CompilationInput) => CompilationResult;

export function sourceFixture(name: string, area = "compiler") {
  return {
    sourceId: name,
    text: fs.readFileSync(new URL(`../../specifications/${area}/fixtures/${name}`, import.meta.url), "utf8"),
  };
}

export function inputFor(source: CompilationInput["source"], dependencies: Catalog = { modules: [], packages: [] }): CompilationInput {
  return { source, dependencies };
}

// This adapter supplies authored input and observes the real public result.
// It never reads source text to derive an expected declaration or diagnostic.
export class Language {
  readonly input: CompilationInput;
  result: CompilationResult | undefined;
  private readonly compileOperation: CompileOperation;

  constructor(source: CompilationInput["source"], dependencies?: Catalog, compileOperation?: CompileOperation) {
    this.input = inputFor(source, dependencies);
    const compiler = createCompiler();
    this.compileOperation = compileOperation ?? compiler.compile.bind(compiler);
  }

  compile() {
    this.result = this.compileOperation(this.input);
    return this.result;
  }

  expectAccepted(): Accepted {
    expect(this.result?.status, "the authored specification should compile").toBe("accepted");
    if (this.result?.status !== "accepted") throw new Error("No accepted specification was returned");
    expect(this.result.diagnostics).toEqual([]);
    return this.result;
  }

  expectRejected(code: string) {
    expect(this.result?.status, `the specification should be rejected with ${code}`).toBe("rejected");
    if (this.result?.status !== "rejected") throw new Error("No rejected result was returned");
    expect(this.result).not.toHaveProperty("specification");
    const diagnostic = this.result.diagnostics.find((item) => item.code === code);
    expect(diagnostic, `a ${code} diagnostic should explain the rejection`).toBeDefined();
    if (!diagnostic) throw new Error(`Missing diagnostic ${code}`);
    return diagnostic;
  }

  expectProblemAt(code: string, line: number, column: number, spelling: string) {
    const diagnostic = this.expectRejected(code);
    expect(diagnostic.primary.kind).toBe("source");
    if (diagnostic.primary.kind !== "source") throw new Error("Expected a source diagnostic");
    const range = diagnostic.primary.range;
    expect(range.sourceId).toBe(this.input.source.sourceId);
    expect(range.start).toMatchObject({ line, column });
    expect(range.end).toMatchObject({ line, column: column + [...spelling].length });
    expect(range.end.offset - range.start.offset).toBe([...spelling].length);
    return diagnostic;
  }
}

export function symbolAt(specification: Specification, ...path: string[]): Symbol {
  const matches = specification.symbols.filter((symbol) => symbol.kind !== "construction" && JSON.stringify(symbol.path) === JSON.stringify(path));
  expect(matches, `one declaration at ${path.join(".")}`).toHaveLength(1);
  return matches[0]!;
}

export function typeShape(specification: Specification, id: TypeId | undefined) {
  expect(id, "a type should be supplied").toBeDefined();
  const type = specification.types.find((candidate) => candidate.id.value === id?.value);
  expect(type, "the type identifier should resolve in the returned model").toBeDefined();
  if (!type) throw new Error("Missing semantic type");
  return type.shape;
}

// Complete dependency INPUT metadata, authored independently of compiler output.
export function resultsCatalog(): Catalog {
  const result = { value: "results:ValidationResult" };
  const boolean = { value: "results:Boolean" };
  const text = { value: "results:Text" };
  const messages = { value: "results:ListText" };
  const record = { value: "results:record" };
  const acceptedField = { value: "results:accepted" };
  const messagesField = { value: "results:messages" };
  const common = { typeParameters: [], parameters: [], resultSpecified: false, fields: [], members: [], publicMembers: [] };
  return {
    packages: [],
    modules: [{
      locator: "results",
      exports: [result],
      types: [
        { id: boolean, shape: { kind: "primitive", primitiveName: "Boolean" } },
        { id: text, shape: { kind: "primitive", primitiveName: "Text" } },
        { id: messages, shape: { kind: "list", element: text } },
        { id: record, shape: { kind: "declared", declaration: result, arguments: [] } },
      ],
      symbols: [
        {
          ...common, id: result, path: ["ValidationResult"], kind: "record-type",
          origin: { kind: "external", locator: "results", exportedPath: ["ValidationResult"] },
          valueType: record, members: [acceptedField, messagesField],
          fields: [
            { symbol: acceptedField, name: "accepted", valueType: boolean, optional: false, hasDefault: false },
            { symbol: messagesField, name: "messages", valueType: messages, optional: false, hasDefault: false },
          ],
        },
        {
          ...common, id: acceptedField, path: ["ValidationResult", "accepted"], kind: "field", owner: result, valueType: boolean,
          origin: { kind: "external", locator: "results", exportedPath: ["ValidationResult", "accepted"] },
        },
        {
          ...common, id: messagesField, path: ["ValidationResult", "messages"], kind: "field", owner: result, valueType: messages,
          origin: { kind: "external", locator: "results", exportedPath: ["ValidationResult", "messages"] },
        },
      ],
    }],
  };
}
