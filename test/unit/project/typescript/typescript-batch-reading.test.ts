import { createHash } from 'node:crypto';
import type ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Compiler, SpecificationIdentity, TypeScriptProject, typescriptOutput,
  type ArtifactAssociation, type ProjectRead, type ProjectSnapshot } from '../../../../src/index.js';
import { TypeScriptSymbols } from '../../../../src/project/typescript/typescript-symbols.js';

const observation = vi.hoisted(() => ({ active: undefined as { programs: number; disposed: number } | undefined }));
vi.mock('typescript', async importOriginal => {
  const actual = await importOriginal<{ default: typeof ts }>(), native = actual.default;
  return { ...actual, default: new Proxy(native, { get(target, key, receiver) {
    if (key !== 'createLanguageService') return Reflect.get(target, key, receiver);
    return function (this: typeof ts, ...args: Parameters<typeof native.createLanguageService>) {
      const service = Reflect.apply(native.createLanguageService, this, args) as ts.LanguageService, work = observation.active;
      if (!work) return service;
      const getProgram = service.getProgram, dispose = service.dispose, seen = new WeakSet<ts.Program>();
      service.getProgram = () => {
        const program = getProgram.call(service);
        if (program && !seen.has(program)) { seen.add(program); work.programs++; }
        return program;
      };
      service.dispose = () => { work.disposed++; dispose.call(service); };
      return service;
    };
  } }) };
});
afterEach(() => { observation.active = undefined; vi.restoreAllMocks(); });
const nativeWork = () => observation.active = { programs: 0, disposed: 0 };
const book = 'export interface Book { title: string }', library = 'export interface Library { name: string }';
const file = (path: string, text: string) => ({ path, bytes: Buffer.from(text), version: createHash('sha256').update(text).digest('hex') });
const snapshot = (sources: Record<string, string> = { 'src/Book.ts': book, 'src/Library.ts': library }): ProjectSnapshot => ({
  root: { path: process.cwd(), identity: 'captured-batch' }, complete: true, problems: [], excludeNames: ['node_modules'], excluded: [],
  files: [file('tsconfig.json', JSON.stringify({ compilerOptions: { lib: ['ES5'], types: [], strict: true }, include: ['src/**/*.ts'] })),
    ...Object.entries(sources).map(([path, text]) => file(path, text))],
});
const association = (name: string): ArtifactAssociation => ({ specId: name, locator: { outputId: 'typescript', format: 'typescript-symbol-1',
  value: { file: `src/${name}.ts`, declaration: [{ kind: 'interface', name }] } } });
const reader = () => new TypeScriptProject({ outputId: 'typescript', configFile: 'tsconfig.json' }, ['Book', 'Library'].map(association));
const source = (read: ProjectRead, path: string) => Buffer.from(read.artifacts.find(item => item.file.path === path)!.file.bytes).toString();

async function generatedOutput() {
  const compilation = new Compiler().compile({ source: { sourceId: 'main.expec', text: 'type Book { title: Text }\ntype Library { name: Text }' },
    locator: 'main', dependencies: { modules: [], packages: [] } });
  if (!compilation.value) throw Error(JSON.stringify(compilation));
  let next = 0;
  const current = new SpecificationIdentity(() => 'batch-' + ++next).associate(compilation.value).value!;
  const output = typescriptOutput.open({ directory: 'src', configFile: 'tsconfig.json' }), captured = snapshot({});
  const plan = await output.plan({ operation: 'create', current }, captured);
  if (!plan.value) throw Error(JSON.stringify(plan.problems));
  return { output, ids: ['Book', 'Library'].map(name => current.baseline.elements.find(item => item.address.name === name)!.id),
    captured: { ...captured, files: [...captured.files, ...plan.value.changes.map(change => {
      if (change.kind !== 'write') throw Error('Initial type generation must write files');
      return { path: change.path, bytes: change.bytes, version: createHash('sha256').update(change.bytes).digest('hex') };
    })] } };
}

describe('reading several native TypeScript contracts', () => {
  it('reads Book and Library in request order with one real native program', () => {
    const work = nativeWork(), reads = reader().readAll(['Library', 'Book', 'Library'], snapshot());
    expect(reads).toHaveLength(3);
    expect(reads.map(read => read.artifacts[0]!.file.path)).toEqual(['src/Library.ts', 'src/Book.ts', 'src/Library.ts']);
    expect(source(reads[0]!, 'src/Library.ts')).toBe(library);
    expect(source(reads[1]!, 'src/Book.ts')).toBe(book);
    expect(source(reads[2]!, 'src/Library.ts')).toBe(library);
    expect(reads.map(read => read.problems)).toEqual([[], [], []]);
    expect(reads.map(read => read.coverage.complete)).toEqual([true, true, true]);
    expect(work).toEqual({ programs: 1, disposed: 1 });
  });

  it('keeps duplicate results independent of each other and their captured source', () => {
    const captured = snapshot(), [first, second] = reader().readAll(['Book', 'Book'], captured);
    first!.artifacts[0]!.file.bytes.fill(0);
    (first!.coverage.limitations as string[]).push('caller mutation');
    expect(source(second!, 'src/Book.ts')).toBe(book);
    expect(second!.coverage.limitations).toEqual([]);
    expect(Buffer.from(captured.files.find(item => item.path === 'src/Book.ts')!.bytes).toString()).toBe(book);
  });

  it('observes changed source on the next call without changing an earlier answer', () => {
    const project = reader(), before = project.readAll(['Book'], snapshot())[0]!;
    const changed = project.readAll(['Book'], snapshot({ 'src/Book.ts': 'export interface Book { isbn: string }', 'src/Library.ts': library }))[0]!;
    expect(source(before, 'src/Book.ts')).toBe(book);
    expect(source(changed, 'src/Book.ts')).toBe('export interface Book { isbn: string }');
    expect(changed.problems).toEqual([]);
  });

  it('reports a missing actual declaration despite its saved association', () => {
    const reads = reader().readAll(['Book', 'Library'], snapshot({ 'src/Book.ts': 'export interface Other {}', 'src/Library.ts': library }));
    expect(reads[0]!.problems.map(problem => problem.code)).toContain('missing-project-symbol');
    expect(reads[0]!.coverage.complete).toBe(false);
    expect(source(reads[0]!, 'src/Book.ts')).toBe('export interface Other {}');
    expect(source(reads[1]!, 'src/Library.ts')).toBe(library);
  });

  it('retains native diagnostics instead of certifying unchecked source', () => {
    const reads = reader().readAll(['Book', 'Library'], snapshot({ 'src/Book.ts': book + '\nconst wrong: number = "many";', 'src/Library.ts': library }));
    expect(reads.map(read => read.problems.some(problem => problem.code === 'typescript-2322'))).toEqual([true, true]);
    expect(reads.map(read => read.coverage.complete)).toEqual([false, false]);
  });

  it('keeps an unknown subject diagnostic separate from known subjects', () => {
    const reads = reader().readAll(['Unknown', 'Book'], snapshot());
    expect(reads[0]!.problems.map(problem => problem.code)).toContain('unassociated-subject');
    expect(reads[0]!.coverage.complete).toBe(false);
    expect(reads[1]!.problems).toEqual([]);
    expect(reads[1]!.coverage.complete).toBe(true);
  });

  it('rejects an absent subject slot before creating native analysis', () => {
    const work = nativeWork();
    expect(() => reader().readAll(new Array<string>(1), snapshot())).toThrow(TypeError);
    expect(work).toEqual({ programs: 0, disposed: 0 });
  });

  it('does no native work for an empty request', () => {
    const work = nativeWork();
    expect(reader().readAll([], snapshot())).toEqual([]);
    expect(work).toEqual({ programs: 0, disposed: 0 });
  });

  it('releases native analysis when producing a result fails', () => {
    const failure = Error('Deliberate native-query failure'), work = nativeWork();
    vi.spyOn(TypeScriptSymbols.prototype, 'definitions').mockImplementationOnce(() => { throw failure; });
    expect(() => reader().readAll(['Book', 'Library'], snapshot())).toThrow(failure);
    expect(work).toEqual({ programs: 1, disposed: 1 });
  });

  it('batches generated output ownership and real source inspection together', async () => {
    const generated = await generatedOutput(), work = nativeWork();
    const reads = await generated.output.readAll!(generated.ids, generated.captured);
    expect(reads.map(read => read.artifacts[0]!.file.path)).toEqual(['src/Book.ts', 'src/Library.ts']);
    expect(source(reads[0]!, 'src/Book.ts')).toContain('title: string');
    expect(source(reads[1]!, 'src/Library.ts')).toContain('name: string');
    expect(reads.map(read => read.problems)).toEqual([[], []]);
    expect(reads.map(read => read.coverage.complete)).toEqual([true, true]);
    expect(work).toEqual({ programs: 1, disposed: 1 });
  });

  it('keeps invalid output ownership visible in every batch result', async () => {
    const generated = await generatedOutput(), ownership = generated.captured.files.find(item => item.path.startsWith('.expec/outputs/'))!;
    const invalid = JSON.parse(Buffer.from(ownership.bytes).toString()); invalid.renderFormat = 2;
    const captured = { ...generated.captured, files: generated.captured.files.map(item => item === ownership ? file(item.path, JSON.stringify(invalid)) : item) };
    const reads = await generated.output.readAll!(generated.ids, captured);
    expect(reads.map(read => read.problems.some(problem => problem.code === 'output-options-changed'))).toEqual([true, true]);
    expect(reads.map(read => read.coverage.complete)).toEqual([false, false]);
  });
});