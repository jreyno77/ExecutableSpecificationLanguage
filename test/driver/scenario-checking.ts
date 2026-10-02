import {
  LangiumReader, LangiumModel, Resolver, TypeDescriber, ExpressionChecker, FixtureChecker, ScenarioChecker, isNodeId,
  type Check, type Item, type ModuleModel, type NodeId, type Origin, type ProblemLocation, type ReadResult, type Resolution, type TypeCatalog,
} from '../../src/index.js';

export class ScenarioCheckingDriver {
  private readonly modules: ModuleModel[] = [];
  private readonly texts = new Map<string, string>();
  private readonly identities = new Map<NodeId, number>();
  private readonly operations = new Map<string, NodeId>();
  private readonly reports = new Map<string, { report: Check; snapshot: Check }>();
  private catalog!: TypeCatalog;
  private resolution!: Resolution;
  private expressions!: ExpressionChecker;
  private fixtures!: FixtureChecker;
  private checker!: ScenarioChecker;
  private selected!: Item<'scenario' | 'example'>;
  private result!: Check;
  private reading!: ReadResult;
  private error: unknown;
  private before = '';

  module(locator: string, text: string): void { this.modules.push(this.read(locator, text)); }
  attemptSource(text: string): void {
    this.texts.set('scenarios.expec', text);
    this.reading = new LangiumReader().read({ sourceId: 'scenarios.expec', text });
  }
  sourceReading(): ReadResult { return this.reading; }
  sourceSpan(text: string) {
    const source = this.texts.get('scenarios.expec')!, index = source.indexOf(text);
    if (index < 0 || index !== source.lastIndexOf(text)) throw new Error(`Expected one ${text} in source`);
    const start = Array.from(source.slice(0, index)).length;
    return { start, end: start + Array.from(text).length };
  }
  source(text: string): void {
    this.resolution = new Resolver().resolve(this.read('scenarios.expec', text), { modules: this.modules, packages: [] });
    this.catalog = new TypeDescriber().describe(this.resolution);
    this.expressions = new ExpressionChecker(this.catalog);
    this.fixtures = new FixtureChecker(this.catalog, this.expressions);
    this.checker = new ScenarioChecker(this.catalog.inspection, this.expressions, this.fixtures);
    this.before = this.inspectionSnapshot();
  }
  check(title: string, kind: 'scenario' | 'example'): void {
    this.selected = this.example(title, kind);
    this.result = this.checker.check(this.selected.id);
  }
  findings(): Check { return this.result; }
  upstreamProblems() { return this.resolution.problems; }
  steps(): string[] { return this.scenario().steps.map(step => this.textAt(step.origin)); }
  step(number: number): Item<'given' | 'when' | 'then'> {
    const step = this.scenario().steps[number - 1];
    if (!step) throw new Error(`Expected step ${number}`);
    return step;
  }
  operation(step: number) { return this.expressions.calledOperation(this.step(step).content.id); }
  namedOperation(name: string): NodeId {
    const kinds = ['function', 'capability', 'setup', 'action', 'observation', 'check'] as const;
    const matches = kinds.flatMap(kind => [...this.catalog.inspection.query(kind)]).filter(item => item.name === name);
    if (matches.length !== 1) throw new Error(`Expected one operation named ${name}`);
    return matches[0]!.id;
  }
  argument(step: number, number: number): string {
    const call = this.step(step).content;
    if (call.kind !== 'call-expression' || !call.arguments[number - 1]) throw new Error(`Expected argument ${number} at step ${step}`);
    return this.textAt(call.arguments[number - 1]!.origin);
  }
  capture(step: number) {
    const item = this.step(step);
    if (item.kind === 'then' || !item.capture) throw new Error(`Expected capture at step ${step}`);
    return item.capture;
  }
  actual(): Item { return this.shortExample().actual; }
  expected(): Item { return this.shortExample().expected; }
  prose(): string[] {
    const candidates = this.selected.kind === 'example' ? [this.selected.expected] : this.selected.steps.map(step => step.content);
    return candidates.flatMap(item => item.kind === 'prose-expectation' ? [item.text.value] : []);
  }
  fixtureFindings(name: string) { return this.fixtures.check(this.fixture(name).id); }
  fixtureSpan(name: string, text: string) { return this.locate(text, this.fixture(name).origin); }
  textAt(location: ProblemLocation): string {
    return location.kind === 'source'
      ? Array.from(this.texts.get(location.module)!).slice(location.range.start.offset, location.range.end.offset).join('') : '';
  }
  span(location: ProblemLocation) {
    return location.kind === 'source'
      ? { module: location.module, start: location.range.start.offset, end: location.range.end.offset } : undefined;
  }
  expectedSpan(text: string, step?: number) { return this.locate(text, step ? this.step(step).origin : this.selected.origin); }
  rememberOperation(step: number, label: string): void {
    const result = this.operation(step);
    if (!result.value || result.problems.length || result.deferred.length) throw new Error('Expected a selected operation');
    this.operations.set(label, result.value);
  }
  rememberedOperation(label: string): NodeId {
    const operation = this.operations.get(label);
    if (!operation) throw new Error(`No remembered operation ${label}`);
    return operation;
  }
  rememberReport(label: string): void { this.reports.set(label, { report: this.result, snapshot: structuredClone(this.result) }); }
  rememberedReport(label: string) {
    const report = this.reports.get(label);
    if (!report) throw new Error(`No remembered report ${label}`);
    return report;
  }
  inspectionSnapshots() { return { before: this.before, after: this.inspectionSnapshot() }; }
  attemptFunction(name: string): void {
    const declaration = [...this.catalog.inspection.query('function')].find(item => item.name === name);
    if (!declaration) throw new Error(`Expected function ${name}`);
    this.attempt(declaration.id);
  }
  attemptForeign(other: ScenarioCheckingDriver, title: string): void { this.attempt(other.example(title, 'example').id); }
  queryError(): unknown { return this.error; }

  private read(locator: string, text: string): ModuleModel {
    const read = new LangiumReader().read({ sourceId: locator, text });
    if (read.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.texts.set(locator, text);
    return new LangiumModel(locator, read.document);
  }
  private example(title: string, kind: 'scenario' | 'example'): Item<'scenario' | 'example'> {
    const matches = [...this.catalog.inspection.query(kind)].filter(item => item.title.value === title);
    if (matches.length !== 1) throw new Error(`Expected one ${kind} titled ${title}`);
    return matches[0]!;
  }
  private scenario(): Item<'scenario'> {
    if (this.selected.kind !== 'scenario') throw new Error('Expected a selected scenario');
    return this.selected;
  }
  private shortExample(): Item<'example'> {
    if (this.selected.kind !== 'example') throw new Error('Expected a selected short example');
    return this.selected;
  }
  private fixture(name: string): Item<'fixture'> {
    const matches = [...this.catalog.inspection.query('fixture')].filter(item => item.name === name);
    if (matches.length !== 1) throw new Error(`Expected one fixture named ${name}`);
    return matches[0]!;
  }
  private locate(text: string, origin: Origin) {
    if (origin.kind !== 'source') throw new Error('Expected source origin');
    const within = this.textAt(origin), index = within.indexOf(text);
    if (index < 0 || index !== within.lastIndexOf(text)) throw new Error(`Expected one ${JSON.stringify(text)} within ${JSON.stringify(within)}`);
    const start = origin.range.start.offset + Array.from(within.slice(0, index)).length;
    return { module: origin.module, start, end: start + Array.from(text).length };
  }
  private attempt(id: NodeId): void {
    this.error = undefined;
    try { this.checker.check(id); } catch (error) { this.error = error; }
  }
  private inspectionSnapshot(): string {
    const kinds = ['scenario', 'example', 'fixture', 'reference', 'concept', 'function'] as const;
    return JSON.stringify(kinds.map(kind => [...this.catalog.inspection.query(kind)]), (_, value: unknown) => {
      if (!isNodeId(value)) return value;
      if (!this.identities.has(value)) this.identities.set(value, this.identities.size);
      return { nodeId: this.identities.get(value) };
    });
  }
}
