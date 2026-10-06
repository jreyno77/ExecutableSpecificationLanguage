import {
  LangiumReader, LangiumModel, Resolver, TypeDescriber, ExpressionChecker, FixtureChecker, isNodeId,
  type Check, type Item, type NodeId, type ProblemLocation, type TypeCatalog, type TypeFact, type TypeId,
} from '../../../src/index.js';

export class FixtureDataDriver {
  private text = '';
  private catalog!: TypeCatalog;
  private checker!: FixtureChecker;
  private expressions!: ExpressionChecker;
  private selected!: Item<'fixture'>;
  private result!: Check<TypeId>;
  private expression!: Check;
  private error: unknown;
  private before = '';
  private readonly identities = new Map<NodeId, number>();
  private readonly reports = new Map<string, Check<TypeId>>();
  private readonly remembered = new Map<string, { report: Check<TypeId>; snapshot: Check<TypeId> }>();

  source(text: string): void {
    this.text = text;
    const read = new LangiumReader().read({ sourceId: 'fixtures.expec', text });
    if (read.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.catalog = new TypeDescriber().describe(new Resolver().resolve(new LangiumModel('fixtures.expec', read.document), { modules: [], packages: [] }));
    this.expressions = new ExpressionChecker(this.catalog);
    this.checker = new FixtureChecker(this.catalog, this.expressions);
    this.before = this.inspectionSnapshot();
  }
  check(name: string): void {
    this.selected = this.fixture(name);
    this.result = this.checker.check(this.selected.id);
    this.reports.set(name, this.result);
  }
  checkInitializerAsExpression(name: string): void {
    const fixture = this.fixture(name);
    this.expression = this.expressions.checkValue(fixture.value.id, known(this.catalog.typeOf(fixture.declaredType.id)));
  }
  findings(): Check<TypeId> { return this.result; }
  expressionFindings(): Check { return this.expression; }
  previous(name: string): Check<TypeId> {
    const report = this.reports.get(name);
    if (!report) throw new Error(`No previous report for ${name}`);
    return report;
  }
  declaredType(): TypeId { return known(this.catalog.typeOf(this.selected.declaredType.id)); }
  namedType(name: string): TypeId {
    const type = [...this.catalog.inspection.query('builtin-type'), ...this.catalog.inspection.query('record-type-declaration')].find(item => item.name === name);
    if (!type) throw new Error(`Expected named type ${name}`);
    return this.catalog.declaredType(type.id);
  }
  typeDescription(type: TypeId) { return this.catalog.describe(type); }
  declaredDestination(text: string): TypeId {
    if (this.textAt(this.selected.value.origin) === text) return this.declaredType();
    const record = this.selected.value;
    if (record.kind !== 'record-expression') throw new Error('Expected a directly initialized fixture or record field');
    const entry = record.entries.find(entry => this.textAt(entry.value.origin) === text);
    const fields = known(this.catalog.fields(this.declaredType()));
    if (fields.kind !== 'available') throw new Error('Expected visible record fields');
    const field = fields.fields.find(field => this.catalog.inspection.read(field.declaration, 'field').name === entry?.name);
    if (!field) throw new Error(`Expected a declared destination for ${text}`);
    return known(field.type);
  }
  textAt(location: ProblemLocation): string {
    return location.kind === 'source' ? Array.from(this.text).slice(location.range.start.offset, location.range.end.offset).join('') : '';
  }
  span(location: ProblemLocation) {
    return location.kind === 'source' ? { start: location.range.start.offset, end: location.range.end.offset } : undefined;
  }
  expectedSpan(text: string, context: { line?: number; fixture?: string } = { fixture: this.selected.name }) {
    const lines = this.text.split('\n');
    const line = context.line ?? (context.fixture ? lines.findIndex(line => line.includes(`fixture ${context.fixture}:`)) + 1 : undefined);
    const within = line ? lines[line - 1]! : this.text;
    const first = within.indexOf(text), last = within.lastIndexOf(text);
    if (first < 0 || first !== last) throw new Error(`Expected one ${JSON.stringify(text)} in ${JSON.stringify(context)}`);
    const prefix = (line ? lines.slice(0, line - 1).join('\n') + (line > 1 ? '\n' : '') : '') + within.slice(0, first);
    const start = Array.from(prefix).length;
    return { start, end: start + Array.from(text).length };
  }
  fixtureInitializer(name: string): string { return this.textAt(this.fixture(name).value.origin); }
  remember(name: string): void {
    this.remembered.set(name, { report: this.result, snapshot: {
      ...structuredClone(this.result), ...(this.result.value ? { value: this.result.value } : {}),
    } });
  }
  memory(name: string) {
    const memory = this.remembered.get(name);
    if (!memory) throw new Error(`No remembered report ${name}`);
    return memory;
  }
  inspectionSnapshots() { return { before: this.before, after: this.inspectionSnapshot() }; }
  attemptType(name: string): void {
    const type = [...this.catalog.inspection.query('record-type-declaration')].find(type => type.name === name);
    if (!type) throw new Error(`Expected type ${name}`);
    this.attempt(type.id);
  }
  attemptForeign(other: FixtureDataDriver, name: string): void { this.attempt(other.fixture(name).id); }
  queryError(): unknown { return this.error; }

  private attempt(id: NodeId): void {
    this.error = undefined;
    try { this.checker.check(id); } catch (error) { this.error = error; }
  }
  private fixture(name: string): Item<'fixture'> {
    const fixture = [...this.catalog.inspection.query('fixture')].find(item => item.name === name);
    if (!fixture) throw new Error(`Expected fixture ${name}`);
    return fixture;
  }
  private inspectionSnapshot(): string {
    const kinds = ['fixture', 'reference', 'record-type-declaration', 'field', 'function'] as const;
    return JSON.stringify(kinds.map(kind => [...this.catalog.inspection.query(kind)]), (_, value: unknown) => {
      if (!isNodeId(value)) return value;
      if (!this.identities.has(value)) this.identities.set(value, this.identities.size);
      return { nodeId: this.identities.get(value) };
    });
  }
}

function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error(`Expected a known authored type: ${JSON.stringify(fact)}`);
  return fact.value;
}
