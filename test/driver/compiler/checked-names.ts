import { onTestFinished, vi } from 'vitest';
import {
  Compiler, LangiumModel, LangiumReader, Resolver, SourceComposer,
  type CheckedSourceNames, type Compilation, type Item, type NodeId, type NodeKind,
  type Model, type Origin, type SourceRange, type Specification,
} from '../../../src/index.js';

export type NameOwnerAnchor = { kind: NodeKind; sourceId: string; line: number; column: number };
export type NameLocation = { sourceId: string; line: number; column: number; endColumn: number; spelling: string };

/** Uses actual compiled name facts; source coordinates only locate authored inputs. */
export class CheckedNameDriver {
  private readonly compiler = new Compiler();
  private readonly sources = new Map<string, string>();
  private readonly capturedSources = new WeakMap<Specification, ReadonlyMap<string, string>>();
  private entry = 'book';
  private compilation?: Compilation;
  private analysisCounts?: () => readonly number[];
  private analysisBaseline?: readonly number[];

  source(locator: string, text: string): void { this.entry = locator; this.sources.set(locator, text); }
  module(locator: string, text: string): void { this.sources.set(locator, text); }

  compile(withoutPrivateEvidence = false): Compilation {
    const captured = new Map([...this.sources].map(([locator, text]) => [`${locator}.expec`, text]));
    const models = [...this.sources].map(([locator, text]) => {
      const read = new LangiumReader().read({ sourceId: `${locator}.expec`, text });
      if (read.status !== 'accepted') throw new Error('The authored source was rejected: ' + JSON.stringify(read.diagnostics));
      return new LangiumModel(locator, read.document);
    });
    const entry = one(models.filter(model => model.locator === this.entry), 'entry model');
    const resolution = new SourceComposer().compose(entry, { modules: models.filter(model => model !== entry), packages: [] });
    const model = resolution.model;
    const publicModel: Model = { roots: model.roots.bind(model), nodes: model.nodes.bind(model), node: model.node.bind(model),
      children: model.children.bind(model), parent: model.parent.bind(model), resolution: model.resolution.bind(model) };
    this.compilation = this.compiler.compile({ resolution: withoutPrivateEvidence
      ? { entry: resolution.entry, model: publicModel, problems: resolution.problems, deferred: resolution.deferred } : resolution });
    if (this.compilation.value) this.capturedSources.set(this.compilation.value, captured);
    return this.compilation;
  }

  specification(): Specification {
    if (!this.compilation?.value) throw new Error('No successful checked Specification was recorded.');
    return this.compilation.value;
  }

  names(specification = this.specification()): CheckedSourceNames {
    // The DSL asserts this public capability before any query is attempted.
    return specification.names;
  }

  offset(sourceId: string, line: number, column: number, specification = this.specification()): number {
    const text = this.capturedSources.get(specification)?.get(sourceId);
    if (text === undefined) throw new Error('No captured source text for ' + sourceId);
    const lines = text.split('\n'), selected = lines[line - 1];
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1
      || selected === undefined || column > Array.from(selected).length + 1) {
      throw new RangeError('Authored name coordinates must lie in the captured source.');
    }
    return lines.slice(0, line - 1).reduce((sum, preceding) => sum + Array.from(preceding).length + 1, 0) + column - 1;
  }

  range(location: NameLocation, specification = this.specification()): SourceRange {
    return {
      sourceId: location.sourceId,
      start: { offset: this.offset(location.sourceId, location.line, location.column, specification), line: location.line, column: location.column },
      end: { offset: this.offset(location.sourceId, location.line, location.endColumn, specification), line: location.line, column: location.endColumn },
    };
  }

  owner(anchor: NameOwnerAnchor, specification = this.specification()): NodeId {
    const offset = this.offset(anchor.sourceId, anchor.line, anchor.column, specification);
    return one([...specification.inspection.query(anchor.kind)]
      .filter(item => this.startsAt(this.nameOrigin(item), anchor.sourceId, offset)), 'authored ' + anchor.kind + ' owner').id;
  }

  introduction(sourceId: string, line: number, column: number, specification = this.specification()): NodeId {
    const offset = this.offset(sourceId, line, column, specification), inspection = specification.inspection;
    const kinds = ['concept', 'field', 'let', 'record-type-declaration', 'capability'] as const;
    const declarations: Item[] = kinds.flatMap(kind => [...inspection.query(kind)]);
    const introductions = [...inspection.query('name')].filter(name => {
      const parent = inspection.parent(name.id);
      return parent && (('alias' in parent && parent.alias?.id === name.id)
        || ('capture' in parent && parent.capture?.id === name.id));
    });
    const matches = [...declarations, ...introductions].filter(item => this.startsAt(this.nameOrigin(item), sourceId, offset));
    return one([...new Map(matches.map(item => [item.id, item])).values()], 'authored spelling introduction').id;
  }

  rememberAnalysisWork(): void {
    const spies = [
      vi.spyOn(LangiumReader.prototype, 'read'),
      vi.spyOn(SourceComposer.prototype, 'compose'),
      vi.spyOn(Resolver.prototype, 'resolve'),
      vi.spyOn(Compiler.prototype, 'compile'),
    ];
    this.analysisCounts = () => spies.map(spy => spy.mock.calls.length);
    this.analysisBaseline = this.analysisCounts();
    onTestFinished(() => { for (const spy of spies) spy.mockRestore(); });
  }

  analysisWork(): { before: readonly number[]; after: readonly number[] } {
    if (!this.analysisCounts || !this.analysisBaseline) throw new Error('Analysis work was not recorded before queries.');
    return { before: this.analysisBaseline, after: this.analysisCounts() };
  }

  private nameOrigin(item: Item): Origin | undefined {
    return item.kind === 'name' ? item.origin : 'nameOrigin' in item ? item.nameOrigin : undefined;
  }
  private startsAt(origin: Origin | undefined, sourceId: string, offset: number): boolean {
    return origin?.kind === 'source' && origin.range.sourceId === sourceId && origin.range.start.offset === offset;
  }
}

function one<T>(items: readonly T[], description: string): T {
  if (items.length !== 1) throw new Error(`Expected one ${description}; found ${items.length}.`);
  return items[0]!;
}
