import { builtinNames, InspectionView, createNodeId, type BuiltinName, type InspectionNode, type ModuleInspection, type NodeId, type Origin, type ReferenceLookup } from '../inspection.js';

type DefinitionName = { readonly name: string; readonly local?: boolean };
type TypeParameters = { readonly typeParameters?: readonly string[] };
export interface ExternalField extends DefinitionName {
  readonly kind: 'field'; readonly type: TypeExpression; readonly hasDefault?: boolean;
}
export interface ExternalParameter { readonly name: string; readonly type: TypeExpression; readonly hasDefault?: boolean }
export type ExternalDefinition = DefinitionName & (
  | ({ readonly kind: 'record-type'; readonly fields: readonly ExternalField[] } & TypeParameters)
  | ({ readonly kind: 'alias-type'; readonly target: TypeExpression } & TypeParameters)
  | ({ readonly kind: 'opaque-type' } & TypeParameters)
  | { readonly kind: 'concept' | 'component' | 'class' | 'interface'; readonly members: readonly (ExternalDefinition | ExternalField)[];
      readonly public: readonly string[]; readonly construction?: readonly ExternalParameter[] }
  | { readonly kind: 'function' | 'capability'; readonly parameters: readonly ExternalParameter[]; readonly result?: TypeExpression }
);
export type TypeExpression =
  | { readonly kind: 'named'; readonly path: readonly string[]; readonly module?: string; readonly arguments?: readonly TypeExpression[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName; readonly arguments?: readonly TypeExpression[] }
  | { readonly kind: 'parameter'; readonly name: string }
  | { readonly kind: 'tuple'; readonly elements: readonly TypeExpression[] }
  | { readonly kind: 'union'; readonly alternatives: readonly TypeExpression[] }
  | { readonly kind: 'optional'; readonly inner: TypeExpression }
  | { readonly kind: 'literal'; readonly value:
      { readonly kind: 'text'; readonly value: string } | { readonly kind: 'boolean'; readonly value: boolean }
      | { readonly kind: 'number'; readonly decimal: string } };
export interface InspectionInputProblem { readonly message: string; readonly at: Extract<Origin, { kind: 'external' }> }
export class InspectionInputError extends Error {
  override readonly name = 'InspectionInputError';
  readonly code = 'invalid-dependency-input';
  constructor(readonly problems: readonly InspectionInputProblem[]) { super('External definitions have invalid structure.'); }
}

type Path = readonly (string | number)[];
type Data = Record<string, unknown>;
type Placement = 'root' | 'member' | 'field';

/** The external input boundary validates and adapts a finite definition tree once. */
export class ExternalInspection extends InspectionView implements ModuleInspection {
  constructor(readonly locator: string, definitions: readonly ExternalDefinition[]) {
    const adapter = new ExternalNodes(locator);
    const roots = adapter.collection(definitions, [], (value, path) => adapter.definition(value, path, 'root'));
    if (adapter.problems.length) throw new InspectionInputError(adapter.problems);
    super(roots, adapter.nodes);
  }
}

class ExternalNodes {
  readonly nodes: InspectionNode[] = [];
  readonly problems: InspectionInputProblem[] = [];
  private readonly ancestors = new WeakSet<object>();
  constructor(private readonly locator: string) {}

  private problem(path: Path, message: string): void {
    this.problems.push({ message, at: { kind: 'external', module: this.locator, path: [...path] } });
  }
  private object<T>(value: unknown, path: Path, consume: (data: Data) => T): T | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.problem(path, 'Expected an object.'); return undefined;
    }
    if (this.ancestors.has(value)) { this.problem(path, 'Cyclic input objects are not declarations. Use a named reference.'); return undefined; }
    this.ancestors.add(value);
    try { return consume(value as Data); } finally { this.ancestors.delete(value); }
  }
  collection<T>(value: unknown, path: Path, consume: (value: unknown, path: Path) => T | undefined): T[] {
    if (!Array.isArray(value)) { this.problem(path, 'Expected an ordered collection.'); return []; }
    if (this.ancestors.has(value)) { this.problem(path, 'Cyclic input collection.'); return []; }
    this.ancestors.add(value);
    try {
      const result: T[] = [];
      for (let index = 0; index < value.length; index++) {
        const accepted = consume(value[index], [...path, index]);
        if (accepted !== undefined) result.push(accepted);
      }
      return result;
    } finally { this.ancestors.delete(value); }
  }
  private text(value: unknown, path: Path): string {
    if (typeof value === 'string' && value.length > 0) return value;
    this.problem(path, 'Expected nonempty text.'); return '';
  }
  private boolean(value: unknown, path: Path): boolean {
    if (value === undefined) return false;
    if (typeof value === 'boolean') return value;
    this.problem(path, 'Expected a boolean.'); return false;
  }
  private keys(data: Data, path: Path, allowed: readonly string[]): void {
    for (const key of Object.keys(data)) if (!allowed.includes(key)) this.problem([...path, key], `Unsupported property ${key}.`);
  }
  private add(path: Path, payload: () => InspectionNode['payload']): NodeId {
    const id = createNodeId();
    const index = this.nodes.length;
    // Reserve the parent's position before creating any children.
    this.nodes.push(undefined as unknown as InspectionNode);
    this.nodes[index] = { id, origin: { kind: 'external', module: this.locator, path: [...path] }, payload: payload() } as InspectionNode;
    return id;
  }
  private name(value: unknown, path: Path): NodeId {
    return this.add(path, () => ({ kind: 'name', decoded: this.text(value, path) }));
  }
  private reference(segments: unknown, path: Path, lookup?: ReferenceLookup): NodeId {
    return this.add(path, () => {
      const names = this.collection(segments, [...path, 'path'], (segment, location) => this.name(segment, location));
      if (!names.length) this.problem([...path, 'path'], 'A reference requires at least one name.');
      return { kind: 'reference', segments: names, ...(lookup ? { lookup } : {}), resolution: { status: 'not-analyzed' } };
    });
  }
  private singleReference(value: unknown, path: Path, lookup?: ReferenceLookup, namePath = path): NodeId {
    return this.add(path, () => ({ kind: 'reference', segments: [this.name(value, namePath)],
      ...(lookup ? { lookup } : {}), resolution: { status: 'not-analyzed' } }));
  }
  private generics(data: Data, path: Path): NodeId[] {
    return this.collection(data.typeParameters === undefined ? [] : data.typeParameters, [...path, 'typeParameters'], (name, at) =>
      this.add(at, () => ({ kind: 'type-parameter', name: this.name(name, at) })));
  }
  definition(value: unknown, path: Path, placement: Placement): NodeId | undefined {
    return this.object(value, path, data => {
      const local = this.boolean(data.local, [...path, 'local']);
      const kind = data.kind;
      const allowed = placement === 'root'
        ? ['record-type', 'alias-type', 'opaque-type', 'concept', 'component', 'class', 'interface', 'function']
        : placement === 'field' ? ['field']
        : ['record-type', 'alias-type', 'opaque-type', 'concept', 'component', 'class', 'interface', 'field', 'capability'];
      if (typeof kind !== 'string' || !allowed.includes(kind)) {
        this.problem([...path, 'kind'], `Unsupported ${placement} declaration kind ${String(kind)}.`); return undefined;
      }
      const declaration = () => this.add(path, () => {
        const name = this.name(data.name, [...path, 'name']);
        const shared = ['kind', 'name', 'local'];
        switch (kind) {
          case 'record-type': {
            this.keys(data, path, [...shared, 'typeParameters', 'fields']);
            return { kind: 'record-type-declaration', name, typeParameters: this.generics(data, path),
              fields: this.collection(data.fields, [...path, 'fields'], (field, at) => this.definition(field, at, 'field')) };
          }
          case 'alias-type': {
            this.keys(data, path, [...shared, 'typeParameters', 'target']);
            return { kind: 'alias-type-declaration', name, typeParameters: this.generics(data, path), targetType: this.type(data.target, [...path, 'target'])! };
          }
          case 'opaque-type':
            this.keys(data, path, [...shared, 'typeParameters']);
            return { kind: 'opaque-type-declaration', name, typeParameters: this.generics(data, path) };
          case 'concept': case 'component': case 'class': case 'interface': {
            this.keys(data, path, [...shared, 'members', 'public', 'construction']);
            const members: NodeId[] = [];
            if (data.construction !== undefined) members.push(this.add([...path, 'construction'], () => ({
              kind: 'construction', parameters: this.parameters(data.construction, [...path, 'construction']),
            })));
            members.push(this.add([...path, 'public'], () => ({ kind: 'public', references:
              this.collection(data.public, [...path, 'public'], (name, at) => this.singleReference(name, at)),
            })));
            members.push(...this.collection(data.members, [...path, 'members'], (member, at) => this.definition(member, at, 'member')));
            return { kind, name, members };
          }
          case 'function': case 'capability': {
            this.keys(data, path, [...shared, 'parameters', 'result']);
            const parameters = this.parameters(data.parameters, [...path, 'parameters']);
            const returnType = data.result === undefined ? undefined : this.type(data.result, [...path, 'result']);
            return { kind, name, parameters, ...(returnType ? { returnType } : {}), body: { kind: 'unavailable' } };
          }
          case 'field':
            this.keys(data, path, [...shared, 'type', 'hasDefault']);
            return { kind: 'field', name, declaredType: this.type(data.type, [...path, 'type'])!, hasDefault: this.boolean(data.hasDefault, [...path, 'hasDefault']) };
          default: throw new Error('Validated declaration kind has no adapter.');
        }
      });
      return local ? this.add(path, () => ({ kind: 'local', declaration: declaration() })) : declaration();
    });
  }
  private parameters(value: unknown, path: Path): NodeId[] {
    return this.collection(value, path, (value, at) => this.object(value, at, data => {
      this.keys(data, at, ['name', 'type', 'hasDefault']);
      return this.add(at, () => ({ kind: 'parameter', name: this.name(data.name, [...at, 'name']),
        declaredType: this.type(data.type, [...at, 'type'])!, hasDefault: this.boolean(data.hasDefault, [...at, 'hasDefault']) }));
    }));
  }
  private type(value: unknown, path: Path): NodeId | undefined {
    return this.object(value, path, data => this.add(path, () => {
      switch (data.kind) {
        case 'named': {
          this.keys(data, path, ['kind', 'path', 'module', 'arguments']);
          const lookup: ReferenceLookup | undefined = data.module === undefined ? undefined : { kind: 'module', locator: this.text(data.module, [...path, 'module']) };
          return { kind: 'named-type', reference: this.reference(data.path, path, lookup),
            arguments: this.typeList(data.arguments === undefined ? [] : data.arguments, [...path, 'arguments']) };
        }
        case 'builtin': {
          this.keys(data, path, ['kind', 'name', 'arguments']);
          if (!builtinNames.includes(data.name as BuiltinName)) this.problem([...path, 'name'], 'Unknown builtin name.');
          return { kind: 'named-type', reference: this.singleReference(data.name, path, { kind: 'builtin' }, [...path, 'name']),
            arguments: this.typeList(data.arguments === undefined ? [] : data.arguments, [...path, 'arguments']) };
        }
        case 'parameter':
          this.keys(data, path, ['kind', 'name']);
          return { kind: 'named-type', reference: this.singleReference(data.name, path, { kind: 'type-parameter' }, [...path, 'name']), arguments: [] };
        case 'tuple':
          this.keys(data, path, ['kind', 'elements']);
          return { kind: 'tuple-type', elements: this.typeList(data.elements, [...path, 'elements']) };
        case 'union':
          this.keys(data, path, ['kind', 'alternatives']);
          return { kind: 'union-type', alternatives: this.typeList(data.alternatives, [...path, 'alternatives']) };
        case 'optional':
          this.keys(data, path, ['kind', 'inner']);
          return { kind: 'optional-type', inner: this.type(data.inner, [...path, 'inner'])! };
        case 'literal': {
          this.keys(data, path, ['kind', 'value']);
          let negative = false;
          const literal = this.object(data.value, [...path, 'value'], literal => this.add([...path, 'value'], () => {
            switch (literal.kind) {
              case 'text':
                this.keys(literal, [...path, 'value'], ['kind', 'value']);
                if (typeof literal.value !== 'string') this.problem([...path, 'value', 'value'], 'Expected text.');
                return { kind: 'string-literal', value: typeof literal.value === 'string' ? literal.value : '' };
              case 'boolean':
                this.keys(literal, [...path, 'value'], ['kind', 'value']);
                if (typeof literal.value !== 'boolean') this.problem([...path, 'value', 'value'], 'Expected a boolean.');
                return { kind: 'boolean-literal', value: literal.value === true };
              case 'number': {
                this.keys(literal, [...path, 'value'], ['kind', 'decimal']);
                const decimal = this.text(literal.decimal, [...path, 'value', 'decimal']);
                if (!/^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(decimal)) this.problem([...path, 'value', 'decimal'], 'Expected a finite decimal spelling.');
                negative = decimal.startsWith('-');
                return { kind: 'number-literal', token: negative ? decimal.slice(1) : decimal };
              }
              default:
                this.problem([...path, 'value', 'kind'], 'Unknown literal form.');
                return { kind: 'string-literal', value: '' };
            }
          }));
          return { kind: 'literal-type', value: literal!, negative };
        }
        default:
          this.problem([...path, 'kind'], `Unknown type form ${String(data.kind)}.`);
          return { kind: 'tuple-type', elements: [] };
      }
    }));
  }
  private typeList(value: unknown, path: Path): NodeId[] { return this.collection(value, path, (item, at) => this.type(item, at)); }
}
