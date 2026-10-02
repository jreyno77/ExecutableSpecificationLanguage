import {
  LangiumReader, LangiumModel, ExternalModel, Resolver, TypeDescriber, ExpressionChecker, InteractionChecker, isNodeId,
  type Check, type Communication, type ExternalDefinition, type Inspection, type Item, type ModuleModel, type NodeId,
  type ProblemLocation, type Resolution, type TypeCatalog, type TypeId,
} from '../../src/index.js';

export interface SourceSelection { readonly text: string; readonly within?: string }

export class InteractionCheckingDriver {
  private text = '';
  private readonly modules: ModuleModel[] = [];
  private readonly identities = new Map<NodeId, number>();
  private readonly reports = new Map<string, { report: Check<Communication>; snapshot: Check<Communication> }>();
  private catalog!: TypeCatalog;
  private resolution!: Resolution;
  private checker!: InteractionChecker;
  private other!: Inspection;
  private result!: Check<Communication>;
  private messageQuery = false;
  private error: unknown;
  private before = '';

  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.modules.push(new ExternalModel(locator, definitions)); }
  source(text: string): void {
    this.text = text;
    this.resolution = new Resolver().resolve(this.read(text), { modules: this.modules, packages: [] });
    this.catalog = new TypeDescriber().describe(this.resolution);
    this.checker = new InteractionChecker(this.catalog, new ExpressionChecker(this.catalog));
  }
  otherSource(text: string): void {
    this.other = new TypeDescriber().describe(new Resolver().resolve(this.read(text), { modules: [], packages: [] })).inspection;
  }
  checkInteraction(title: string): void {
    this.messageQuery = false;
    this.result = this.checker.check(this.interaction(title).id);
  }
  checkMessage(title: string, number: number): void {
    this.messageQuery = true;
    this.result = this.message(title, number);
  }
  findings(): Check<Communication> { return this.result; }
  checkingMessage(): boolean { return this.messageQuery; }
  upstreamProblems() { return this.resolution.problems; }
  message(title: string, number: number): Check<Communication> { return this.checker.message(this.messageNode(title, number).id); }
  messages(title: string): Check<Communication>[] { return this.authoredMessages(title).map(message => this.checker.message(message.id)); }
  messageNames(value: Communication) {
    return { from: this.catalog.inspection.read(value.sender, 'participant').name,
      to: this.catalog.inspection.read(value.receiver, 'participant').name, operation: this.operationName(value.operation) };
  }
  participant(title: string, name: string): NodeId {
    const matches = this.interaction(title).members.filter(member => member.kind === 'participant' && member.name === name);
    if (matches.length !== 1) throw new Error(`Expected one participant ${name} in ${title}`);
    return matches[0]!.id;
  }
  operation(name: string): NodeId {
    const matches = [...this.catalog.inspection.query('capability')].filter(item => this.operationName(item.id) === name);
    if (matches.length !== 1) throw new Error(`Expected one capability ${name}`);
    return matches[0]!.id;
  }
  operationOrigin(title: string, number: number) {
    const report = this.message(title, number);
    if (!report.value) throw new Error('Expected a checked communication');
    return this.catalog.inspection.read(report.value.operation).origin;
  }
  capture(title: string, name: string): Check<Communication> {
    const matches = this.authoredMessages(title).filter(message => message.capture?.decoded === name);
    if (matches.length !== 1) throw new Error(`Expected one authored capture ${name}`);
    return this.checker.message(matches[0]!.id);
  }
  namedType(name: string): TypeId {
    const declarations = [...this.catalog.inspection.query('builtin-type'), ...this.catalog.inspection.query('record-type-declaration')];
    const matches = declarations.filter(item => item.name === name);
    if (matches.length !== 1) throw new Error(`Expected one type ${name}`);
    return this.catalog.declaredType(matches[0]!.id);
  }
  arguments(title: string, number: number): string[] { return this.messageNode(title, number).arguments.map(argument => this.textAt(argument.origin)); }
  textAt(location: ProblemLocation): string {
    return location.kind === 'source' ? Array.from(this.text).slice(location.range.start.offset, location.range.end.offset).join('') : '';
  }
  span(location: ProblemLocation) {
    return location.kind === 'source' ? { module: location.module, start: location.range.start.offset, end: location.range.end.offset } : undefined;
  }
  expectedSpan({ text, within }: SourceSelection) {
    const outer = within ?? this.text, offset = within ? this.text.indexOf(within) : 0;
    if (offset < 0 || within && offset !== this.text.lastIndexOf(within)) throw new Error(`Expected one context ${within}`);
    const index = outer.indexOf(text);
    if (index < 0 || index !== outer.lastIndexOf(text)) throw new Error(`Expected one ${JSON.stringify(text)} within ${JSON.stringify(within ?? 'source')}`);
    const start = Array.from(this.text.slice(0, offset + index)).length;
    return { module: 'interactions.expec', start, end: start + Array.from(text).length };
  }
  rememberInspection(): void { this.before = this.inspectionSnapshot(); }
  inspectionSnapshots() { return { before: this.before, after: this.inspectionSnapshot() }; }
  rememberReport(label: string): void {
    this.reports.set(label, { report: this.result, snapshot: {
      ...structuredClone(this.result), ...(this.result.value ? { value: { ...this.result.value } } : {}),
    } });
  }
  rememberedReport(label: string) {
    const report = this.reports.get(label);
    if (!report) throw new Error(`No remembered report ${label}`);
    return report;
  }
  attemptDeclaration(name: string): void { this.attempt(() => this.checker.check(this.operation(name))); }
  attemptOtherMessage(title: string, number: number): void {
    const message = this.messageNode(title, number, this.other);
    this.attempt(() => this.checker.message(message.id));
  }
  queryError(): unknown { return this.error; }

  private interaction(title: string, inspection = this.catalog.inspection): Item<'interaction'> {
    const matches = [...inspection.query('interaction')].filter(item => item.title.value === title);
    if (matches.length !== 1) throw new Error(`Expected one interaction titled ${title}`);
    return matches[0]!;
  }
  private authoredMessages(title: string, inspection = this.catalog.inspection): Item<'message'>[] {
    return this.interaction(title, inspection).members.filter(member => member.kind === 'message');
  }
  private messageNode(title: string, number: number, inspection = this.catalog.inspection): Item<'message'> {
    const message = this.authoredMessages(title, inspection)[number - 1];
    if (!message) throw new Error(`Expected message ${number} in ${title}`);
    return message;
  }
  private operationName(id: NodeId): string {
    const operation = this.catalog.inspection.read(id, 'capability');
    const owner = this.catalog.inspection.parent(id);
    if (!owner || !('name' in owner)) throw new Error('Expected a capability owner');
    return `${owner.name}.${operation.name}`;
  }
  private read(text: string): ModuleModel {
    const read = new LangiumReader().read({ sourceId: 'interactions.expec', text });
    if (read.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(read.diagnostics));
    return new LangiumModel('interactions.expec', read.document);
  }
  private attempt(query: () => unknown): void {
    this.error = undefined;
    try { query(); } catch (error) { this.error = error; }
  }
  private inspectionSnapshot(): string {
    const kinds = ['interaction', 'reference', 'concept', 'component', 'class', 'interface'] as const;
    return JSON.stringify(kinds.map(kind => [...this.catalog.inspection.query(kind)]), (_, value: unknown) => {
      if (!isNodeId(value)) return value;
      if (!this.identities.has(value)) this.identities.set(value, this.identities.size);
      return { nodeId: this.identities.get(value) };
    });
  }
}
