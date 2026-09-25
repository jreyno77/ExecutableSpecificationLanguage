import type { SourceNode, SourceNodeId } from '../grammar/source.js';
import type { BuiltinCatalog, CompilationResult, CompilerDiagnostic, CompilationObligation, DerivedRelationship, DiagnosticOrigin, ResolvedSpecification, SymbolKind, SymbolRecord, TypeId, TypeShape, ValidationInput } from '../model/compiler.js';
import { CompilationUnimplementedError } from '../unimplemented.js';

export const builtinCatalog: BuiltinCatalog = {
  version: 'candidate-0.1',
  definitions: [
    { name: 'Text', arity: 0, category: 'primitive' },
    { name: 'Number', arity: 0, category: 'primitive' },
    { name: 'Boolean', arity: 0, category: 'primitive' },
    { name: 'List', arity: 1, category: 'container' },
    { name: 'Nothing', arity: 0, category: 'no-result' },
  ],
};
for (const definition of builtinCatalog.definitions) Object.freeze(definition);
Object.freeze(builtinCatalog.definitions);
Object.freeze(builtinCatalog);

type Scope = { parent?: Scope; owner?: SymbolRecord; names: Map<string, SymbolRecord> };
const conceptKinds = new Set(['concept', 'component', 'class', 'interface']);
const typeKinds = new Set(['primitive-type', 'container-type', 'no-result-type', 'record-type', 'alias-type', 'opaque-type', 'type-parameter', ...conceptKinds]);

// Exact decimal normalization without allocating enormous powers or rounding to binary floats.
function decimalKey(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) throw new Error('Invalid numeric token in source model');
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = /0*$/.exec(digits)![0].length;
  const exponent = BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailing);
  return `${match[1]}${digits.slice(0, digits.length - trailing)}e${exponent}`;
}

export class SemanticValidator {
  constructor(builtins: BuiltinCatalog = builtinCatalog) {
    const ordered = (catalog: BuiltinCatalog) => [...catalog.definitions].sort((a, b) => a.name.localeCompare(b.name));
    if (builtins.version !== builtinCatalog.version || JSON.stringify(ordered(builtins)) !== JSON.stringify(ordered(builtinCatalog))) {
      throw new Error('The compiler requires the candidate-0.1 builtin profile');
    }
  }
  validate(input: ValidationInput): CompilationResult {
    return new ValidationRun(input).run();
  }
}

/** Per-call state prevents declarations or catalog facts leaking between compilations. */
class ValidationRun {
  private readonly model: ResolvedSpecification;
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly obligations: CompilationObligation[] = [];
  private readonly root: Scope = { names: new Map() };
  private readonly declarations = new Map<number, SymbolRecord>();
  private readonly scopes = new Map<number, Scope>();
  private readonly symbolScopes = new Map<string, Scope>();
  private readonly aliasesInProgress = new Set<string>();
  private readonly localOwners = new Map<string, SymbolRecord>();
  private readonly typeCache = new Map<string, TypeId>();

  constructor(private readonly input: ValidationInput) {
    this.model = {
      grammarVersion: 'candidate-0.1', document: input.document, source: input.description,
      symbols: [], types: [], bindings: [], expressionTypes: [], typeResolutions: [],
      imports: [], publicContracts: [], dependencies: [], packages: [], relationships: [],
    };
  }

  run(): CompilationResult {
    const packageAliases = new Map<string, number>();
    for (const [index, entry] of this.input.dependencies.packages.entries()) {
      const previous = packageAliases.get(entry.alias);
      if (previous !== undefined) this.diagnostics.push({
        code: 'invalid-dependency-catalog', phase: 'input', explanation: `Package alias ${entry.alias} occurs more than once.`,
        primary: { kind: 'input', propertyPath: `dependencies.packages[${index}].alias` },
        related: [{ kind: 'input', propertyPath: `dependencies.packages[${previous}].alias` }],
      });
      packageAliases.set(entry.alias, index);
    }
    for (const node of this.input.description.nodes) {
      if (['include', 'extend', 'examples-attachment'].includes(node.payload.kind)) {
        this.problem('composition-required', node.id, 'This declaration requires the specification composition stage.', 'composition');
      }
    }
    if (this.diagnostics.length) return this.rejected();
    // These are implementation limits, not a conclusion that valid authored source is invalid.
    if (this.input.dependencies.modules.length) throw new CompilationUnimplementedError('supplied module catalogs');
    for (const node of this.input.description.nodes) {
      if (['use', 'examples', 'interaction', 'requires', 'ensures'].includes(node.payload.kind)) {
        throw new CompilationUnimplementedError(`${node.payload.kind} semantic validation`);
      }
    }
    this.installBuiltins();
    for (const id of this.input.description.roots) this.declare(id, this.root);
    for (const id of this.input.description.roots) this.validateDeclaration(id);
    if (this.diagnostics.length) return this.rejected();
    return { status: 'accepted', specification: this.model, diagnostics: [], obligations: this.obligations };
  }

  private rejected(): CompilationResult {
    const key = (d: CompilerDiagnostic) => d.primary.kind === 'source'
      ? `${d.primary.range.sourceId}:${String(d.primary.range.start.offset).padStart(12, '0')}:${d.phase}:${d.code}`
      : `${d.primary.propertyPath}:${d.phase}:${d.code}`;
    return { status: 'rejected', diagnostics: this.diagnostics.sort((a, b) => key(a).localeCompare(key(b))) };
  }
  private node(id: SourceNodeId): SourceNode {
    const node = this.input.description.nodes[id.ordinal];
    if (!node || node.id.sourceId !== id.sourceId) throw new Error('Invalid source-model node reference');
    return node;
  }
  private name(id: SourceNodeId): string {
    const p = this.node(id).payload;
    if (p.kind !== 'name') throw new Error('Expected source NameNode');
    return p.decoded;
  }
  private problem(code: string, source: SourceNodeId, explanation: string, phase: CompilerDiagnostic['phase'] = 'resolution', related: DiagnosticOrigin[] = []): void {
    this.diagnostics.push({ code, phase, explanation, primary: { kind: 'source', range: this.node(source).range }, related });
  }
  private origin(symbol: SymbolRecord): DiagnosticOrigin {
    return symbol.origin.kind === 'source'
      ? { kind: 'source', range: this.node(symbol.origin.node).range }
      : { kind: 'input', propertyPath: symbol.origin.kind === 'builtin' ? `builtins.${symbol.origin.name}` : `symbols.${symbol.id.value}` };
  }
  private symbol(kind: SymbolKind, path: string[], origin: SymbolRecord['origin'], owner?: SymbolRecord): SymbolRecord {
    const symbol: SymbolRecord = {
      id: { value: `s${this.model.symbols.length}` }, path, kind, origin,
      typeParameters: [], parameters: [], resultSpecified: false, fields: [], members: [], publicMembers: [],
      ...(owner ? { owner: owner.id } : {}),
    };
    this.model.symbols.push(symbol);
    return symbol;
  }
  private type(shape: TypeShape): TypeId {
    const key = JSON.stringify(shape);
    const cached = this.typeCache.get(key);
    if (cached) return cached;
    const id = { value: `t${this.model.types.length}` };
    this.model.types.push({ id, shape });
    this.typeCache.set(key, id);
    return id;
  }
  private shape(id: TypeId): TypeShape {
    const value = this.model.types.find(t => t.id.value === id.value);
    if (!value) throw new Error('Missing semantic type');
    return value.shape;
  }
  private installBuiltins(): void {
    for (const d of builtinCatalog.definitions) {
      const kind = d.category === 'primitive' ? 'primitive-type' : d.category === 'container' ? 'container-type' : 'no-result-type';
      const s = this.symbol(kind, [d.name], { kind: 'builtin', name: d.name });
      this.root.names.set(d.name, s);
      if (kind === 'primitive-type') s.valueType = this.type({ kind: 'primitive', primitiveName: d.name as 'Text' | 'Number' | 'Boolean' });
      if (kind === 'no-result-type') s.valueType = this.type({ kind: 'no-result' });
    }
  }
  private introduce(id: SourceNodeId, nameId: SourceNodeId, kind: SymbolKind, scope: Scope): SymbolRecord {
    const name = this.name(nameId);
    const previous = scope.names.get(name) ?? (this.root.names.get(name)?.origin.kind === 'builtin' ? this.root.names.get(name) : undefined);
    if (previous) this.problem('duplicate-declaration', nameId, `${name} is already declared in this scope or reserved as a builtin.`, 'resolution', [this.origin(previous)]);
    const symbol = this.symbol(kind, [...(scope.owner?.path ?? []), name], { kind: 'source', node: id }, scope.owner);
    if (!previous) scope.names.set(name, symbol);
    scope.owner?.members.push(symbol.id);
    this.declarations.set(id.ordinal, symbol);
    return symbol;
  }
  private declare(id: SourceNodeId, scope: Scope, local = false): void {
    const p = this.node(id).payload;
    this.scopes.set(id.ordinal, scope);
    if (p.kind === 'local') { this.declare(p.declaration, scope, true); return; }
    if (p.kind === 'depends-on' || p.kind === 'public' || p.kind === 'requires-package') return;
    let symbol: SymbolRecord;
    if (p.kind === 'construction') {
      const prior = [...this.declarations.values()].find(s => s.kind === 'construction' && s.owner?.value === scope.owner?.id.value);
      if (prior) this.problem('duplicate-declaration', id, 'Only one construction signature is allowed.', 'resolution', [this.origin(prior)]);
      symbol = this.symbol('construction', scope.owner?.path ?? [], { kind: 'source', node: id }, scope.owner);
      scope.owner?.members.push(symbol.id);
      this.declarations.set(id.ordinal, symbol);
    } else if ('name' in p && ['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'function', 'capability', 'field', 'parameter'].includes(p.kind)) {
      const kind = p.kind.replace('-declaration', '') as SymbolKind;
      symbol = this.introduce(id, p.name, kind, scope);
    } else {
      throw new CompilationUnimplementedError(`declaration ${p.kind}`);
    }
    if (local && scope.owner) this.localOwners.set(symbol.id.value, scope.owner);
    const child: Scope = { parent: scope, owner: symbol, names: new Map() };
    this.symbolScopes.set(symbol.id.value, child);
    if ('typeParameters' in p) {
      for (const [position, nameId] of p.typeParameters.entries()) {
        const param = this.introduce(nameId, nameId, 'type-parameter', child);
        param.valueType = this.type({ kind: 'type-parameter', declaration: symbol.id, position });
        symbol.typeParameters.push(param.id);
      }
    }
    if ('members' in p) for (const item of p.members) this.declare(item, child);
    if ('fields' in p) for (const item of p.fields) this.declare(item, child);
    if ('parameters' in p) for (const item of p.parameters) this.declare(item, child);
    if (['record-type', 'opaque-type', ...conceptKinds].includes(symbol.kind)) {
      symbol.valueType = this.type({ kind: 'declared', declaration: symbol.id, arguments: symbol.typeParameters.map(t => this.getSymbol(t.value).valueType!) });
    }
  }
  private getSymbol(id: string): SymbolRecord {
    const symbol = this.model.symbols.find(s => s.id.value === id);
    if (!symbol) throw new Error('Missing symbol');
    return symbol;
  }
  private lookup(scope: Scope, name: string): SymbolRecord | undefined {
    return scope.names.get(name) ?? (scope.parent ? this.lookup(scope.parent, name) : undefined);
  }
  private within(scope: Scope, owner: SymbolRecord): boolean {
    return scope.owner?.id.value === owner.id.value || Boolean(scope.parent && this.within(scope.parent, owner));
  }
  private resolve(id: SourceNodeId, scope: Scope): SymbolRecord | undefined {
    const p = this.node(id).payload;
    if (p.kind !== 'reference') throw new Error('Expected a ReferenceNode');
    const names = p.segments.map(x => this.name(x));
    let symbol = this.lookup(scope, names[0]!);
    for (const segment of names.slice(1)) symbol = symbol ? this.symbolScopes.get(symbol.id.value)?.names.get(segment) : undefined;
    if (!symbol) { this.problem('unresolved-reference', id, `${names.join('.')} is not declared or supplied in scope.`); return; }
    if (symbol.kind === 'type-parameter' && symbol.owner && !this.within(scope, this.getSymbol(symbol.owner.value))) {
      this.problem('inaccessible-reference', id, `${names.join('.')} is a type parameter local to its generic declaration.`);
      return;
    }
    const localOwner = this.localOwners.get(symbol.id.value);
    if (localOwner && !this.within(scope, localOwner)) { this.problem('inaccessible-reference', id, `${names.join('.')} is local to ${localOwner.path.join('.')}.`); return; }
    if (!this.model.bindings.some(b => b.reference.ordinal === id.ordinal)) this.model.bindings.push({ reference: id, target: symbol.id });
    return symbol;
  }
  private declaredType(symbol: SymbolRecord): TypeId | undefined {
    if (symbol.kind !== 'alias-type') return symbol.valueType;
    if (symbol.aliasTarget) return symbol.aliasTarget;
    if (symbol.origin.kind !== 'source') throw new Error('Expected local alias origin');
    if (this.aliasesInProgress.has(symbol.id.value)) { this.problem('cyclic-type-alias', symbol.origin.node, `Alias ${symbol.path.join('.')} does not terminate.`, 'typing'); return; }
    const p = this.node(symbol.origin.node).payload;
    if (p.kind !== 'alias-type-declaration') throw new Error('Expected alias node');
    this.aliasesInProgress.add(symbol.id.value);
    const value = this.typeNode(p.targetType, this.symbolScopes.get(symbol.id.value)!);
    this.aliasesInProgress.delete(symbol.id.value);
    if (value) { symbol.aliasTarget = value; symbol.valueType = value; }
    return value;
  }
  private substitute(id: TypeId, owner: SymbolRecord, args: TypeId[]): TypeId {
    const s = this.shape(id);
    if (s.kind === 'type-parameter' && s.declaration.value === owner.id.value) return args[s.position]!;
    const sub = (t: TypeId) => this.substitute(t, owner, args);
    if (s.kind === 'tuple') return this.type({ ...s, elements: s.elements.map(sub) });
    if (s.kind === 'union') return this.type({ ...s, alternatives: s.alternatives.map(sub) });
    if (s.kind === 'optional' || s.kind === 'list') return this.type({ ...s, element: sub(s.element) });
    if (s.kind === 'declared') return this.type({ ...s, arguments: s.arguments.map(sub) });
    return id;
  }
  private typeNode(id: SourceNodeId, scope: Scope, allowNothing = false): TypeId | undefined {
    const p = this.node(id).payload;
    let resolved: TypeId | undefined;
    switch (p.kind) {
      case 'named-type': {
        const symbol = this.resolve(p.reference, scope);
        const args = p.arguments.map(a => this.typeNode(a, scope));
        if (!symbol || args.some(t => !t)) return;
        if (!typeKinds.has(symbol.kind)) { this.problem('wrong-reference-kind', p.reference, 'This reference must name a type.'); return; }
        const arity = symbol.kind === 'container-type' ? 1 : symbol.typeParameters.length;
        if (arity !== args.length) { this.problem('generic-arity', id, `${symbol.path.join('.')} expects ${arity} type arguments; received ${args.length}.`, 'typing'); return; }
        if (symbol.kind === 'no-result-type' && !allowNothing) { this.problem('type-mismatch', id, 'Nothing is allowed only as an explicit callable return type.', 'typing'); return; }
        if (symbol.kind === 'container-type') resolved = this.type({ kind: 'list', element: args[0]! });
        else {
          const template = this.declaredType(symbol);
          if (template) resolved = args.length ? this.substitute(template, symbol, args as TypeId[]) : template;
        }
        break;
      }
      case 'grouped-type': resolved = this.typeNode(p.inner, scope, allowNothing); break;
      case 'optional-type': {
        const element = this.typeNode(p.inner, scope);
        if (element) resolved = this.type({ kind: 'optional', element });
        break;
      }
      case 'tuple-type': case 'union-type': {
        const values = (p.kind === 'tuple-type' ? p.elements : p.alternatives).map(t => this.typeNode(t, scope));
        if (values.every(t => t !== undefined)) resolved = p.kind === 'tuple-type' ? this.type({ kind: 'tuple', elements: values }) : this.type({ kind: 'union', alternatives: values });
        break;
      }
      case 'literal-type': {
        const literal = this.literal(p.value);
        if (literal) resolved = this.type({ ...literal, valueText: p.negative ? `-${literal.valueText}` : literal.valueText });
        break;
      }
      default: throw new Error(`Expected a type, got ${p.kind}`);
    }
    if (resolved && !this.model.typeResolutions.some(t => t.source.ordinal === id.ordinal)) this.model.typeResolutions.push({ source: id, resolvedType: resolved });
    return resolved;
  }
  private literal(id: SourceNodeId): Extract<TypeShape, { kind: 'literal' }> | undefined {
    const p = this.node(id).payload;
    if (p.kind === 'string-literal') return { kind: 'literal', primitiveName: 'Text', valueText: p.value };
    if (p.kind === 'number-literal') return { kind: 'literal', primitiveName: 'Number', valueText: p.token };
    if (p.kind === 'boolean-literal') return { kind: 'literal', primitiveName: 'Boolean', valueText: String(p.value) };
    return undefined;
  }
  private compatibleLiteral(actual: Extract<TypeShape, { kind: 'literal' }>, expected: TypeId): boolean {
    const shape = this.shape(expected);
    if (shape.kind === 'primitive') return actual.primitiveName === shape.primitiveName;
    if (shape.kind === 'literal') return actual.primitiveName === shape.primitiveName && (actual.primitiveName === 'Number' ? decimalKey(actual.valueText) === decimalKey(shape.valueText) : actual.valueText === shape.valueText);
    if (shape.kind === 'union') return shape.alternatives.some(t => this.compatibleLiteral(actual, t));
    if (shape.kind === 'optional') return this.compatibleLiteral(actual, shape.element);
    return false;
  }
  private checkDefault(id: SourceNodeId, expected: TypeId): void {
    const literal = this.literal(id);
    if (!literal) throw new CompilationUnimplementedError('nonliteral default expressions');
    const valueType = this.type(literal);
    this.model.expressionTypes.push({ expression: id, role: 'value', valueType });
    if (!this.compatibleLiteral(literal, expected)) this.problem('type-mismatch', id, `${literal.primitiveName} default is incompatible with the declared type.`, 'typing');
  }
  private relateType(id: SourceNodeId, scope: Scope, owner: SymbolRecord, kind: DerivedRelationship['kind'], direction: DerivedRelationship['direction']): void {
    const p = this.node(id).payload;
    if (p.kind === 'named-type') {
      const binding = this.model.bindings.find(b => b.reference.ordinal === p.reference.ordinal);
      const target = binding && this.getSymbol(binding.target.value);
      if (target && target.origin.kind !== 'builtin' && target.kind !== 'type-parameter') this.model.relationships.push({ kind, owner: owner.id, target: target.id, source: p.reference, direction });
      p.arguments.forEach(a => this.relateType(a, scope, owner, kind, direction));
    } else if (p.kind === 'optional-type' || p.kind === 'grouped-type') this.relateType(p.inner, scope, owner, kind, direction);
    else if (p.kind === 'tuple-type' || p.kind === 'union-type') (p.kind === 'tuple-type' ? p.elements : p.alternatives).forEach(t => this.relateType(t, scope, owner, kind, direction));
  }
  private containsLocal(id: TypeId, visited = new Set<string>()): boolean {
    if (visited.has(id.value)) return false;
    visited.add(id.value);
    const s = this.shape(id);
    if (s.kind === 'declared') return this.localOwners.has(s.declaration.value) || s.arguments.some(t => this.containsLocal(t, visited));
    if (s.kind === 'list' || s.kind === 'optional') return this.containsLocal(s.element, visited);
    if (s.kind === 'tuple') return s.elements.some(t => this.containsLocal(t, visited));
    if (s.kind === 'union') return s.alternatives.some(t => this.containsLocal(t, visited));
    return false;
  }
  private mentionsLocal(id: SourceNodeId): boolean {
    const p = this.node(id).payload;
    if (p.kind === 'named-type') {
      const binding = this.model.bindings.find(b => b.reference.ordinal === p.reference.ordinal);
      return Boolean(binding && this.localOwners.has(binding.target.value)) || p.arguments.some(t => this.mentionsLocal(t));
    }
    if (p.kind === 'grouped-type' || p.kind === 'optional-type') return this.mentionsLocal(p.inner);
    if (p.kind === 'tuple-type') return p.elements.some(t => this.mentionsLocal(t));
    if (p.kind === 'union-type') return p.alternatives.some(t => this.mentionsLocal(t));
    return false;
  }
  private validateDeclaration(id: SourceNodeId): void {
    const p = this.node(id).payload;
    const scope = this.scopes.get(id.ordinal)!;
    const symbol = this.declarations.get(id.ordinal);
    if (p.kind === 'local') { this.validateDeclaration(p.declaration); return; }
    if (p.kind === 'depends-on') {
      for (const ref of p.references) {
        const target = this.resolve(ref, scope);
        if (!target) continue;
        if (!typeKinds.has(target.kind)) { this.problem('wrong-reference-kind', ref, 'A dependency must refer to a concept or type.'); continue; }
        this.model.dependencies.push({ owner: scope.owner!.id, target: target.id, source: ref });
        this.model.relationships.push({ kind: 'dependency', owner: scope.owner!.id, target: target.id, source: ref, direction: 'reference' });
      }
      return;
    }
    if (p.kind === 'public') return; // Resolve after the owner's signatures, including forward declarations.
    if (p.kind === 'requires-package') {
      const locator = this.node(p.locator).payload;
      if (locator.kind !== 'string-literal') throw new Error('Expected package locator string');
      const entry = this.input.dependencies.packages.find(item => item.alias === locator.value);
      if (!entry || (p.phase && !entry.phases.includes(p.phase))) this.problem('unavailable-package', p.locator, `Package ${locator.value} is not configured for the requested phase.`);
      else {
        this.model.packages.push({ owner: scope.owner!.id, alias: locator.value, source: id, ...(p.phase ? { phase: p.phase } : {}) });
        this.obligations.push({ kind: 'package-installation-not-verified', source: id, explanation: 'Configured availability does not establish installation.' });
      }
      return;
    }
    if (!symbol) throw new Error(`Missing declaration for ${p.kind}`);
    const child = this.symbolScopes.get(symbol.id.value)!;
    if ('members' in p) {
      for (const member of p.members) this.validateDeclaration(member);
      const seen = new Map<string, SourceNodeId>();
      for (const member of p.members) {
        const publicNode = this.node(member).payload;
        if (publicNode.kind !== 'public') continue;
        for (const ref of publicNode.references) {
          const target = this.resolve(ref, child);
          if (!target) continue;
          if (target.kind !== 'capability' || target.owner?.value !== symbol.id.value) { this.problem('wrong-reference-kind', ref, 'A public entry must name a capability declared by this owner.'); continue; }
          const previous = seen.get(target.id.value);
          if (previous) { this.problem('duplicate-declaration', ref, 'This capability is already exposed publicly.', 'resolution', [{ kind: 'source', range: this.node(previous).range }]); continue; }
          seen.set(target.id.value, ref);
          symbol.publicMembers.push(target.id);
          const exposed = [...target.parameters.map(t => t.valueType), ...(target.resultType ? [target.resultType] : [])];
          const declaration = target.origin.kind === 'source' ? this.node(target.origin.node).payload : undefined;
          const authoredTypes = declaration?.kind === 'capability' ? declaration.parameters.map(t => {
            const parameter = this.node(t).payload;
            if (parameter.kind !== 'parameter') throw new Error('Expected parameter');
            return parameter.declaredType;
          }).concat(declaration.returnType ? [declaration.returnType] : []) : [];
          if (exposed.some(t => this.containsLocal(t)) || authoredTypes.some(t => this.mentionsLocal(t))) this.problem('inaccessible-public-type', ref, 'A public capability cannot expose a local type.');
        }
      }
      this.model.publicContracts.push({ owner: symbol.id, capabilities: [...symbol.publicMembers] });
    }
    if ('fields' in p) {
      for (const field of p.fields) {
        this.validateDeclaration(field);
        const fieldSymbol = this.declarations.get(field.ordinal)!;
        const fp = this.node(field).payload;
        if (fieldSymbol.valueType && fp.kind === 'field') symbol.fields.push({ symbol: fieldSymbol.id, name: this.name(fp.name), valueType: fieldSymbol.valueType, optional: this.shape(fieldSymbol.valueType).kind === 'optional', hasDefault: Boolean(fp.defaultValue), ...(fp.defaultValue ? { defaultSource: fp.defaultValue } : {}) });
      }
    }
    if (p.kind === 'alias-type-declaration') this.declaredType(symbol);
    if (p.kind === 'field' || p.kind === 'parameter') {
      const resolved = this.typeNode(p.declaredType, scope);
      if (resolved) {
        symbol.valueType = resolved;
        if (p.defaultValue) this.checkDefault(p.defaultValue, resolved);
        if (p.kind === 'field') this.relateType(p.declaredType, scope, scope.owner!, 'field', 'reference');
      }
    }
    if ('parameters' in p) {
      let defaultSeen = false;
      const owner = p.kind === 'function' ? symbol : scope.owner!;
      const inputKind = p.kind === 'construction' ? 'construction-input' : p.kind === 'function' ? 'function-input' : 'capability-input';
      for (const paramId of p.parameters) {
        this.validateDeclaration(paramId);
        const param = this.node(paramId).payload;
        const paramSymbol = this.declarations.get(paramId.ordinal)!;
        if (param.kind !== 'parameter') throw new Error('Expected parameter');
        if (defaultSeen && !param.defaultValue) this.problem('argument-count', paramId, 'A required parameter cannot follow a defaulted parameter.', 'typing');
        defaultSeen ||= Boolean(param.defaultValue);
        if (paramSymbol.valueType) symbol.parameters.push({ symbol: paramSymbol.id, name: this.name(param.name), valueType: paramSymbol.valueType, hasDefault: Boolean(param.defaultValue), ...(param.defaultValue ? { defaultSource: param.defaultValue } : {}) });
        this.relateType(param.declaredType, child, owner, inputKind, 'input');
      }
      if (p.kind === 'function' || p.kind === 'capability') {
        symbol.resultSpecified = Boolean(p.returnType);
        if (p.returnType) {
          const resultType = this.typeNode(p.returnType, child, true);
          if (resultType) symbol.resultType = resultType;
          this.relateType(p.returnType, child, owner, p.kind === 'function' ? 'function-output' : 'capability-output', 'output');
        } else this.obligations.push({ kind: 'result-type-unspecified', source: id, explanation: 'No result type is declared.' });
        this.obligations.push({ kind: 'implementation-needed', source: id, explanation: 'A callable contract does not implement its promised behavior.' });
        if (p.body) {
          const body = this.node(p.body).payload;
          if (body.kind !== 'contract-body') throw new CompilationUnimplementedError('helper bodies');
          for (const clauseId of body.members) {
            const clause = this.node(clauseId).payload;
            if (clause.kind === 'promises') this.obligations.push({ kind: 'prose-needs-check', source: clauseId, explanation: 'A prose promise needs an executable check.' });
          }
        }
      }
    }
  }
}
