import {
  LangiumReader, LangiumModel, ExternalModel, Resolver, TypeDescriber, ExpressionChecker,
  type Check, type ExternalDefinition, type Item, type ModuleModel, type NodeId,
  type ProblemLocation, type Resolution, type TypeCatalog, type TypeFact, type TypeId, type ValueScope,
} from '../../src/index.js';

/** Invokes the public checker over a real resolved source and describes its observations. */
export class ExpressionCheckingDriver {
  private entry!: ModuleModel;
  private readonly modules: ModuleModel[] = [];
  private readonly texts = new Map<string, string>();
  private catalog!: TypeCatalog;
  private checker!: ExpressionChecker;
  private resolution!: Resolution;
  private scope?: ValueScope;
  private readonly observedReferences: Item<'reference'>[] = [];
  private result: Check<TypeId> = { problems: [], deferred: [] };

  source(text: string, locator = 'expressions.expec'): void { this.entry = this.read(text, locator); }
  module(locator: string, text: string): void { this.modules.push(this.read(text, locator)); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.modules.push(new ExternalModel(locator, definitions));
  }
  available(names: readonly string[]): void {
    this.prepare();
    const available = new Map(names.map(name => {
      const fixture = this.fixture(name);
      return [fixture.id, known(this.catalog.typeOf(fixture.declaredType.id))] as const;
    }));
    this.scope = reference => {
      this.observedReferences.push(reference);
      if (reference.resolution.status !== 'bound') return undefined;
      const type = available.get(reference.resolution.target);
      return type ? { value: type, problems: [], deferred: [] } : undefined;
    };
  }
  typeOf(name: string): void { this.prepare(); this.result = this.checker.typeOf(this.fixture(name).value.id, this.scope); }
  checkValue(name: string): void {
    this.prepare();
    const fixture = this.fixture(name);
    this.result = this.checker.checkValue(fixture.value.id, known(this.catalog.typeOf(fixture.declaredType.id)), this.scope);
  }
  checkCall(name: string): void { this.prepare(); this.result = this.checker.checkCall(this.fixture(name).value.id, this.scope); }
  checkCondition(name: string): void { this.prepare(); this.result = this.checker.checkCondition(this.fixture(name).value.id, this.scope); }
  checkExpectation(name: string): void { this.prepare(); this.result = this.checker.checkExpectation(this.fixture(name).value.id, this.scope); }
  checkDefault(owner: string, name: string): void {
    this.prepare();
    const declaration = this.declaration(owner);
    const item = this.catalog.inspection.read(declaration);
    const candidates = 'parameters' in item ? item.parameters : item.kind === 'record-type-declaration'
      ? item.fields.flatMap(field => field.kind === 'field' ? [field] : field.declaration.kind === 'field' ? [field.declaration] : []) : [];
    const slot = candidates.find(slot => slot.name === name);
    if (!slot) throw new Error(`Expected default slot ${owner}.${name}`);
    this.result = this.checker.checkDefault(slot.id, this.scope);
  }
  checkContract(name: string): void { this.prepare(); this.result = this.checker.checkContract(this.declaration(name)); }
  findings(): Check<TypeId> { return this.result; }
  scopeReferences(name: string) { return { references: this.observedReferences, target: this.fixture(name).id }; }
  recordEntries(name: string): string[] {
    const value = this.fixture(name).value;
    if (value.kind !== 'record-expression') throw new Error('Expected an authored record expression');
    return value.entries.map(entry => entry.name);
  }
  typeLabel(): string | undefined { return this.result.value && this.label(this.result.value); }
  textAt(location: ProblemLocation): string {
    return location.kind === 'source'
      ? Array.from(this.texts.get(location.module)!).slice(location.range.start.offset, location.range.end.offset).join('')
      : JSON.stringify(location);
  }
  causes() { return { problems: [...this.resolution.problems, ...this.catalog.problems], deferred: this.resolution.deferred }; }
  promises(): string[] { this.prepare(); return [...this.catalog.inspection.query('promises')].map(item => item.text); }

  private prepare(): void {
    if (this.checker) return;
    this.resolution = new Resolver().resolve(this.entry, { modules: this.modules, packages: [] });
    this.catalog = new TypeDescriber().describe(this.resolution);
    this.checker = new ExpressionChecker(this.catalog);
  }
  private fixture(name: string): Item<'fixture'> {
    const fixture = [...this.catalog.inspection.query('fixture')].find(item => item.name === name);
    if (!fixture) throw new Error(`Expected fixture ${name}`);
    return fixture;
  }
  private declaration(name: string): NodeId {
    const ids = [...this.catalog.typeDeclarations(), ...this.catalog.callableDeclarations()];
    const declaration = ids.find(id => { const item = this.catalog.inspection.read(id); return 'name' in item && item.name === name; });
    if (!declaration) throw new Error(`Expected declaration ${name}`);
    return declaration;
  }
  private read(text: string, locator: string): ModuleModel {
    const read = new LangiumReader().read({ sourceId: locator, text });
    if (read.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.texts.set(locator, text);
    return new LangiumModel(locator, read.document);
  }
  private label(id: TypeId): string {
    const type = this.catalog.types.describe(id);
    switch (type.kind) {
      case 'alias': return this.label(known(type.target));
      case 'builtin': case 'declared': {
        const declaration = this.catalog.inspection.read(type.declaration);
        if (!('name' in declaration)) throw new Error('Expected a named type');
        return declaration.name + (type.arguments.length ? `<${type.arguments.map(id => this.label(id)).join(', ')}>` : '');
      }
      case 'parameter': return this.catalog.inspection.read(type.declaration, 'type-parameter').name;
      case 'tuple': return `[${type.elements.map(id => this.label(id)).join(', ')}]`;
      case 'union': return type.alternatives.map(id => this.label(id)).join(' | ');
      case 'optional': return `${this.label(type.inner)}?`;
      case 'literal': return this.textAt(this.catalog.inspection.read(type.expression).origin);
    }
  }
}
function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error(`Expected a known authored type: ${JSON.stringify(fact)}`);
  return fact.value;
}
