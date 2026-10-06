import fs from 'node:fs';
import promises from 'node:fs/promises';
import processes from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { vi } from 'vitest';
import { Compiler, ExternalModel, ExpressionChecker, FixtureChecker, LangiumModel, LangiumReader, SourceComposer,
  TestOperationChecker, TypeDescriber, type Check, type Compilation, type Item, type ModuleModel, type NodeKind,
  type Origin, type ProblemLocation, type TypeCatalog, type TypeId } from '../../../src/index.js';

export class OperationDriver {
  readonly sources = new Map<string, string>();
  readonly modules = new Map<string, ModuleModel>();
  entry!: ModuleModel;
  types!: TypeCatalog;
  operations!: TestOperationChecker;
  result!: Check<unknown>;
  compilation?: Compilation;
  readonly checks = new Map<string, Check>();
  effects?: { calls: number; before: string; after: string };
  source(text: string, options: { sourceId?: string; locator?: string } = {}): void {
    this.entry = this.module(options.locator ?? 'entry', text, options.sourceId ?? 'entry.expec');
  }
  module(locator: string, text: string, sourceId = locator + '.expec'): ModuleModel {
    this.sources.set(sourceId, text);
    const read = new LangiumReader().read({ sourceId, text });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
    const model = new LangiumModel(locator, read.document); this.modules.set(locator, model); return model;
  }
  external(locator: string, name: string, inputs: Record<string, string>, result: string): void {
    this.modules.set(locator, new ExternalModel(locator, [{ kind: 'function', name,
      parameters: Object.entries(inputs).map(([name, type]) => ({ name, type: { kind: 'named', path: [type] } })),
      result: { kind: 'named', path: [result] } }]));
  }
  prepare() {
    const resolution = new SourceComposer().compose(this.entry, { modules: [...this.modules.values()].filter(model => model !== this.entry), packages: [] });
    this.types = new TypeDescriber().describe(resolution);
    const expressions = new ExpressionChecker(this.types);
    this.operations = new TestOperationChecker(this.types, expressions, new FixtureChecker(this.types, expressions));
    return resolution;
  }
  compile(): void {
    const resolution = this.prepare();
    this.observeEffects(() => { this.compilation = new Compiler().compile({ resolution }); this.result = this.compilation; });
    if (this.compilation?.value) this.types = this.compilation.value.types;
  }
  check(name: string): void {
    this.prepare(); this.observeEffects(() => { this.result = this.operations.check(this.named(name).id); });
  }
  checkAll(): void {
    this.prepare(); this.observeEffects(() => {
      for (const kind of ['setup', 'action', 'observation', 'check'] as const) for (const node of this.query(kind)) {
        this.checks.set(node.name, this.operations.check(node.id));
      }
    });
  }
  query<K extends NodeKind>(kind: K): Item<K>[] { return [...this.types.inspection.query(kind)]; }
  named(name: string): Item {
    return one([...this.types.callableDeclarations(), ...this.types.typeDeclarations()].map(id => this.types.inspection.read(id))
      .filter(node => this.name(node) === name || 'name' in node && node.name === name), name);
  }
  name(node: Item): string {
    const parts: string[] = [];
    for (let current: Item | undefined = node; current; current = this.types.inspection.parent(current.id)) if ('name' in current) parts.unshift(current.name);
    return parts.join('.');
  }
  typeName(type: TypeId): string {
    const shape = this.types.describe(type);
    if ('declaration' in shape) return this.name(this.types.inspection.read(shape.declaration))
      + ('arguments' in shape && shape.arguments.length ? '<' + shape.arguments.map(type => this.typeName(type)).join(', ') + '>' : '');
    throw new Error('Expected a named type');
  }
  text(at: ProblemLocation): string {
    return at.kind === 'source' ? Array.from(this.sources.get(at.range.sourceId)!).slice(at.range.start.offset, at.range.end.offset).join('') : '';
  }
  matches(at: ProblemLocation, text: string, within?: string, sourceId?: string): boolean {
    if (at.kind !== 'source' || sourceId && at.range.sourceId !== sourceId || this.text(at) !== text) return false;
    if (!within) return true;
    const source = this.sources.get(at.range.sourceId)!, start = source.indexOf(within);
    return start >= 0 && at.range.start.offset >= start && at.range.end.offset <= start + within.length;
  }
  statements(name: string): readonly Item[] {
    const node = this.named(name);
    if (!('body' in node) || node.body.kind !== 'available') throw new Error('Expected an authored body');
    return node.body.content.members;
  }
  private observeEffects(action: () => void): void {
    const temporary = fs.realpathSync.native(tmpdir()), root = fs.realpathSync.native(fs.mkdtempSync(join(temporary, 'expec-operations-')));
    const sentinel = join(root, 'project.txt'), before = 'handwritten project'; fs.writeFileSync(sentinel, before);
    const spies = [vi.spyOn(fs, 'readFileSync'), vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'readdirSync'), vi.spyOn(fs, 'openSync'),
      vi.spyOn(promises, 'readFile'), vi.spyOn(promises, 'writeFile'), vi.spyOn(promises, 'readdir'), vi.spyOn(promises, 'open'),
      vi.spyOn(processes, 'spawn'), vi.spyOn(processes, 'spawnSync'), vi.spyOn(processes, 'exec'), vi.spyOn(processes, 'execSync')];
    try { action(); }
    finally {
      const calls = spies.reduce((count, spy) => count + spy.mock.calls.length, 0); spies.forEach(spy => spy.mockRestore());
      this.effects = { calls, before, after: fs.readFileSync(sentinel, 'utf8') };
      if (dirname(root) !== temporary || !basename(root).startsWith('expec-operations-') || fs.realpathSync.native(root) !== root) throw new Error('Unexpected fixture path');
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}
export function one<T>(items: readonly T[], label: string): T {
  if (items.length !== 1) throw new Error(`Expected one ${label}; found ${items.length}`); return items[0]!;
}
