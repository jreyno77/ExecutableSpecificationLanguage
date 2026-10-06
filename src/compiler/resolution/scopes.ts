import type { Model, ModelNode, NodeId, ReferenceResolution } from '../../model/model.js';
import type { ProblemLocation, ResolutionProblem } from './problem.js';
import { SourceIndex } from './source-index.js';
import type { Modules } from './modules.js';

export type Introduction = {
  readonly at: ProblemLocation;
  readonly importKey?: string;
} & (
  | { readonly target: ModelNode; readonly problems?: never }
  | { readonly problems: readonly ResolutionProblem[]; readonly target?: never }
);

export class Scope {
  readonly names: Map<string, Introduction[]>;
  constructor(
    readonly parent: Scope | undefined,
    readonly owner: NodeId | undefined,
    readonly composition = false,
    readonly orderedNames: ReadonlySet<string> = new Set(),
    readonly blockedSubject: NodeId | undefined = undefined,
    readonly shared?: Scope,
  ) { this.names = shared?.names ?? new Map(); }
  get canonical(): Scope { return this.shared?.canonical ?? this; }
}

export type Lookup =
  | { readonly status: 'found'; readonly declaration: ModelNode }
  | { readonly status: 'missing' }
  | { readonly status: 'inaccessible'; readonly declaration: ModelNode }
  | { readonly status: 'subject-context'; readonly subject: NodeId }
  | { readonly status: 'ambiguous'; readonly introductions: readonly Introduction[] }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] };

/** Ready lexical/module scopes over common nodes. Construction owns the indexing order. */
export class ScopeGraph {
  readonly problems: ResolutionProblem[] = [];
  readonly imports = new Map<NodeId, ReferenceResolution>();
  private readonly builtinScope = new Scope(undefined, undefined);
  private readonly outside = new Scope(undefined, undefined);
  private readonly scopes: Scope[] = [];
  private readonly moduleRoots = new Map<string, Scope>();
  private readonly nodeScopes = new Map<NodeId, Scope>();
  private readonly indices = new Map<NodeId, SourceIndex>();
  private readonly members = new Map<NodeId, Scope>();
  private readonly privateTo = new Map<NodeId, Scope>();
  private readonly capabilityOwners = new Map<NodeId, Scope>();
  private readonly publicNames = new Map<Scope, Set<string>>();
  private readonly attachedExamples: {
    readonly source: SourceIndex;
    readonly subject: NodeId;
    readonly members: readonly NodeId[];
    readonly scope: Scope;
  }[] = [];

  constructor(
    sources: readonly SourceIndex[],
    builtinModel: Model,
    private readonly modules?: Modules,
    private readonly ownership: ReadonlyMap<NodeId, NodeId> = new Map(),
  ) {
    for (const builtin of builtinModel.nodes('builtin-type')) {
      this.introduce(this.builtinScope, builtinModel.node(builtin.name, 'name').decoded, { target: builtin, at: builtin.origin });
      this.members.set(builtin.id, this.childScope(this.builtinScope, builtin.id));
    }
    // All declarations exist before imports: cyclic modules select actual identities.
    for (const source of sources) {
      const root = this.childScope(this.builtinScope, undefined);
      this.moduleRoots.set(source.locator, root);
      for (const node of source.nodes) this.indices.set(node.id, source);
    }
    for (const source of sources) for (const node of source.roots) this.walk(source, node, this.moduleRoots.get(source.locator)!);
    for (const builtin of builtinModel.nodes('builtin-type')) for (const child of builtinModel.children(builtin.id)) {
      const source = this.indices.get(child);
      if (source) this.walk(source, source.node(child), this.members.get(builtin.id)!);
    }
    this.includeModuleNames();
    for (const source of sources) this.importModuleNames(source);
    this.attachExamples();
    this.finishIntroductions();
  }

  scope(id: NodeId): Scope {
    const scope = this.nodeScopes.get(id);
    if (!scope) throw new Error('Inspected occurrence has no lexical scope.');
    return scope;
  }

  builtin(name: string): Lookup { return this.lookup(this.builtinScope, [name], true); }

  /** Select authored declarations; imported aliases and builtins are not exports. */
  select(locator: string, path: readonly string[], requester = this.outside): Lookup {
    const failures = this.modules?.failures.get(locator);
    if (failures?.length) return { status: 'invalid', problems: failures };
    const root = this.moduleRoots.get(locator);
    if (!root) return { status: 'invalid', problems: [{
      code: 'unavailable-module', message: 'No supplied module has locator ' + locator + '.',
      at: { kind: 'dependency', path: ['modules', locator] }, related: [],
    }] };
    const first = path[0];
    if (first === undefined) return { status: 'missing' };
    let found = this.choose(root, first, requester, true);
    for (const segment of path.slice(1)) {
      if (found.status !== 'found') return found;
      const inside = this.members.get(found.declaration.id);
      if (!inside) return { status: 'missing' };
      found = this.choose(inside, segment, requester, true);
    }
    return found;
  }

  selectFrom(owner: string, authored: string, path: readonly string[], requester: Scope): Lookup {
    const locator = this.modules ? this.modules.locate(owner, authored) : authored;
    if (locator !== undefined) return this.select(locator, path, requester);
    return { status: 'invalid', problems: [{
      code: 'unavailable-module', message: 'No supplied module maps ' + authored + ' from ' + owner + '.',
      at: { kind: 'dependency', path: ['modules', authored] }, related: [],
    }] };
  }

  lookup(scope: Scope, path: readonly string[], ownOnly = false): Lookup {
    const first = path[0];
    if (first === undefined) return { status: 'missing' };
    let selected: Scope | undefined = scope;
    while (selected && !selected.names.has(first)) {
      if (selected.blockedSubject) {
        // A missing subject may supply a nearer name. Only unshadowable builtins
        // can safely bypass that context.
        if (this.builtinScope.names.has(first)) { selected = this.builtinScope; break; }
        return { status: 'subject-context', subject: selected.blockedSubject };
      }
      selected = ownOnly ? undefined : selected.parent;
    }
    if (!selected) return { status: 'missing' };
    let found = this.choose(selected, first, scope);
    for (const segment of path.slice(1)) {
      if (found.status !== 'found') return found;
      const inside = this.members.get(found.declaration.id);
      if (!inside) return { status: 'missing' };
      found = this.choose(inside, segment, scope);
    }
    return found;
  }

  hasOrderedName(scope: Scope, name: string): boolean {
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      if (current.orderedNames.has(name)) return true;
    }
    return false;
  }

  isWithinDeclaration(scope: Scope, declaration: NodeId): boolean {
    const inside = this.members.get(declaration);
    return inside !== undefined && this.within(scope, inside);
  }

  private introduce(scope: Scope, name: string, introduction: Introduction): void {
    const introductions = scope.names.get(name) ?? [];
    introductions.push(introduction);
    scope.names.set(name, introductions);
  }

  private conflicts(name: string, authored: readonly Introduction[]): readonly ResolutionProblem[] {
    const builtin = this.builtinScope.names.get(name)?.[0];
    const introductions = builtin && !authored.includes(builtin) ? [builtin, ...authored] : authored;
    const problems: ResolutionProblem[] = [];
    for (let index = 1; index < introductions.length; index++) {
      const current = introductions[index]!;
      const duplicate = introductions.slice(0, index).find(previous =>
        !current.importKey || !previous.importKey || current.importKey === previous.importKey
        || (current.target && current.target.id === previous.target?.id));
      // Distinct imports are ambiguous when used, not duplicate declarations.
      if (duplicate) problems.push({
        code: 'duplicate-declaration', message: 'The name ' + name + ' is introduced more than once in this scope.',
        at: current.at, related: [duplicate.at],
      });
    }
    return problems;
  }

  private finishIntroductions(): void {
    for (const scope of this.scopes) {
      if (scope.shared) continue;
      for (const [name, introductions] of scope.names) this.problems.push(...this.conflicts(name, introductions));
    }
  }

  private choose(scope: Scope, name: string, from: Scope, exportsOnly = false): Lookup {
    const introductions = (scope.names.get(name) ?? []).filter(item => !exportsOnly || (
      item.importKey === undefined && item.target
      && item.target.kind !== 'builtin-type'
      && item.target.kind !== 'parameter' && item.target.kind !== 'type-parameter'
    ));
    if (!introductions.length) return { status: 'missing' };
    const conflicts = this.conflicts(name, introductions);
    if (conflicts.length) return { status: 'invalid', problems: conflicts };
    const problems = introductions.flatMap(item => item.problems ?? []);
    if (problems.length) return { status: 'invalid', problems };
    const targets = [...new Map(introductions.flatMap(({ target }) => target ? [[target.id, target] as const] : [])).values()];
    if (targets.length > 1) return { status: 'ambiguous', introductions };
    const declaration = targets[0];
    if (!declaration) return { status: 'missing' };
    const privateScope = this.privateTo.get(declaration.id);
    if (privateScope && !this.within(from, privateScope)) return { status: 'inaccessible', declaration };
    const owner = this.capabilityOwners.get(declaration.id);
    if (owner && declaration.kind === 'capability' && !this.within(from, owner)) {
      const name = this.indices.get(declaration.id)!.name(declaration.name);
      if (!this.publicNames.get(owner)?.has(name)) return { status: 'inaccessible', declaration };
    }
    return { status: 'found', declaration };
  }

  private importModuleNames(source: SourceIndex): void {
    const root = this.moduleRoots.get(source.locator)!;
    for (const use of source.of('use')) {
      const locator = source.node(use.locator);
      if (locator.kind !== 'string-literal') throw new Error('Inspected import locator is not text.');
      for (const id of use.imports) {
        const item = source.node(id);
        if (item.kind !== 'import-item') throw new Error('Inspected import item is malformed.');
        const reference = source.node(item.imported);
        const path = source.reference(reference.id);
        const name = item.alias ? source.name(item.alias) : path.at(-1)!;
        const found = this.selectFrom(source.locator, locator.value, path, root);
        const introduction = { at: item.origin, importKey: JSON.stringify([locator.value, path]) };
        if (found.status === 'found') {
          this.introduce(root, name, { ...introduction, target: found.declaration });
          this.imports.set(reference.id, { status: 'bound', target: found.declaration.id });
        } else {
          const problems = this.importProblems(reference, path, found);
          this.introduce(root, name, { ...introduction, problems });
          this.imports.set(reference.id, { status: 'invalid', problems });
          this.problems.push(...problems);
        }
      }
    }
  }

  private includeModuleNames(): void {
    const completed = new Set<string>();
    const include = (locator: string): void => {
      if (completed.has(locator)) return;
      const root = this.moduleRoots.get(locator)!;
      for (const edge of this.modules?.includes.get(locator) ?? []) {
        include(edge.target);
        for (const [name, introductions] of this.moduleRoots.get(edge.target)!.names) {
          for (const introduction of introductions) {
            if (!introduction.target || this.privateTo.has(introduction.target.id)) continue;
            if (!root.names.get(name)?.some(existing => existing.target?.id === introduction.target!.id)) {
              this.introduce(root, name, introduction);
            }
          }
        }
      }
      completed.add(locator);
    };
    for (const locator of this.moduleRoots.keys()) include(locator);
  }

  private importProblems(reference: ModelNode, path: readonly string[], found: Exclude<Lookup, { status: 'found' }>): readonly ResolutionProblem[] {
    if (found.status === 'invalid') return found.problems.map(problem => ({
      ...problem, at: reference.origin, related: [problem.at, ...problem.related],
    }));
    const inaccessible = found.status === 'inaccessible';
    return [{
      code: inaccessible ? 'inaccessible-reference' : found.status === 'ambiguous' ? 'ambiguous-reference' : 'unresolved-reference',
      message: 'The module does not provide an accessible unambiguous declaration for ' + path.join('.') + '.',
      at: reference.origin,
      related: inaccessible ? [found.declaration.origin]
        : found.status === 'ambiguous' ? found.introductions.map(item => item.at) : [],
    }];
  }

  private attachExamples(): void {
    for (const examples of this.attachedExamples) {
      const target = this.lookup(examples.scope, examples.source.reference(examples.subject));
      // Same-module subjects supply lexical ownership. Cross-module example
      // attachment requires composition, independent of the module's producer.
      const subjectScope = target.status === 'found' && this.indices.get(target.declaration.id) === examples.source
        ? this.members.get(target.declaration.id) : undefined;
      const inside = subjectScope
        ? this.childScope(subjectScope)
        : this.childScope(examples.scope, examples.scope.owner, undefined, undefined, examples.subject);
      for (const member of examples.members) this.walk(examples.source, examples.source.node(member), inside);
    }
  }

  private within(scope: Scope, ancestor: Scope): boolean {
    for (let current: Scope | undefined = scope; current; current = current.parent) if (current.canonical === ancestor.canonical) return true;
    return false;
  }

  private childScope(parent: Scope, owner = parent.owner, orderedNames: ReadonlySet<string> = new Set(),
    composition = parent.composition, blockedSubject?: NodeId): Scope {
    const scope = new Scope(parent, owner, composition, orderedNames, blockedSubject);
    this.scopes.push(scope);
    return scope;
  }

  private declare(source: SourceIndex, node: ModelNode, scope: Scope, local: boolean): void {
    if (!('name' in node)) throw new Error('A declaration must have a name.');
    this.introduce(scope, source.name(node.name), { target: node, at: node.origin });
    if (local) this.privateTo.set(node.id, scope.canonical);
    if (node.kind === 'capability') this.capabilityOwners.set(node.id, scope.canonical);
  }

  private parameters(source: SourceIndex, ids: readonly NodeId[], scope: Scope): void {
    const names = new Set(ids.map(id => {
      const parameter = source.node(id);
      if (parameter.kind !== 'parameter') throw new Error('Inspected parameter list contains a non-parameter.');
      return source.name(parameter.name);
    }));
    for (const id of ids) this.walk(source, source.node(id), scope, false, names);
  }

  private walk(source: SourceIndex, node: ModelNode, scope: Scope, local = false, parameterNames?: ReadonlySet<string>): void {
    source = this.indices.get(node.id) ?? source;
    if (this.ownership.has(node.id)) {
      scope = new Scope(this.moduleRoots.get(source.locator), scope.owner, false, new Set(), undefined, scope.canonical);
      this.scopes.push(scope);
    }
    this.nodeScopes.set(node.id, scope);
    const p = node;
    switch (p.kind) {
      case 'local': this.walk(source, source.node(p.declaration), scope, true); return;
      case 'concept': case 'component': case 'class': case 'interface': {
        this.declare(source, node, scope, local);
        const inside = this.childScope(scope, node.id);
        this.members.set(node.id, inside);
        this.walk(source, source.node(p.name), scope);
        for (const member of p.members) this.walk(source, source.node(member), inside);
        return;
      }
      case 'record-type-declaration': case 'alias-type-declaration': case 'opaque-type-declaration': {
        this.declare(source, node, scope, local);
        const inside = this.childScope(scope, node.id);
        this.members.set(node.id, inside);
        this.walk(source, source.node(p.name), scope);
        for (const parameter of p.typeParameters) this.walk(source, source.node(parameter), inside, true);
        if (p.kind === 'record-type-declaration') for (const field of p.fields) this.walk(source, source.node(field), inside);
        if (p.kind === 'alias-type-declaration') this.walk(source, source.node(p.targetType), inside);
        for (const id of source.children(node.id)) if (this.ownership.get(id) === node.id) this.walk(source, source.node(id), inside);
        return;
      }
      case 'capability': case 'function': case 'setup': case 'action': case 'observation': case 'check': {
        this.declare(source, node, scope, local);
        const inside = this.childScope(scope, node.id);
        this.members.set(node.id, inside);
        this.walk(source, source.node(p.name), scope);
        this.parameters(source, p.parameters, inside);
        if (p.returnType) this.walk(source, source.node(p.returnType), inside);
        for (const failure of p.failures) this.walk(source, source.node(failure), inside);
        if (p.body.kind === 'available') this.walk(source, source.node(p.body.node), inside);
        for (const id of source.children(node.id)) if (this.ownership.get(id) === node.id) this.walk(source, source.node(id), inside);
        return;
      }
      case 'construction': this.parameters(source, p.parameters, this.childScope(scope)); return;
      case 'parameter': {
        this.declare(source, node, scope, true);
        this.walk(source, source.node(p.name), scope);
        this.walk(source, source.node(p.declaredType), scope);
        if (p.defaultValue) this.walk(source, source.node(p.defaultValue), this.childScope(scope, scope.owner, parameterNames));
        return;
      }
      case 'field': case 'fixture': case 'participant': case 'type-parameter':
        this.declare(source, node, scope, local); break;
      case 'public': {
        const names = this.publicNames.get(scope.canonical) ?? new Set<string>();
        for (const reference of p.references) {
          const path = source.reference(reference);
          if (path.length === 1) names.add(path[0]!);
        }
        this.publicNames.set(scope.canonical, names);
        break;
      }
      case 'examples': {
        if (this.ownership.has(node.id)) {
          if (p.subject) this.walk(source, source.node(p.subject), this.moduleRoots.get(source.locator)!);
          const inside = this.childScope(scope);
          for (const member of p.members) this.walk(source, source.node(member), inside);
          return;
        }
        if (p.subject) {
          this.walk(source, source.node(p.subject), scope);
          this.attachedExamples.push({ source, subject: p.subject, members: p.members, scope });
          return;
        }
        const inside = this.childScope(scope);
        for (const member of p.members) this.walk(source, source.node(member), inside);
        return;
      }
      case 'contract-body': case 'helper-body': case 'check-body': {
        const ordered = new Set<string>();
        for (const member of p.members) {
          const child = source.node(member);
          if (child.kind === 'let') ordered.add(source.name(child.name));
        }
        const inside = this.childScope(scope, scope.owner, ordered);
        for (const member of p.members) this.walk(source, source.node(member), inside);
        return;
      }
      case 'scenario': {
        const ordered = new Set<string>();
        for (const step of p.steps) {
          const child = source.node(step);
          if ((child.kind === 'given' || child.kind === 'when') && child.capture) {
            ordered.add(source.name(child.capture));
          }
        }
        const inside = this.childScope(scope, scope.owner, ordered);
        for (const child of source.children(node.id)) this.walk(source, source.node(child), inside);
        return;
      }
      case 'interaction': {
        const ordered = new Set<string>();
        for (const member of p.members) {
          const child = source.node(member);
          if (child.kind === 'message' && child.capture) ordered.add(source.name(child.capture));
        }
        const inside = this.childScope(scope, scope.owner, ordered);
        this.walk(source, source.node(p.title), inside);
        this.parameters(source, p.parameters, inside);
        for (const member of p.members) this.walk(source, source.node(member), inside);
        return;
      }
      case 'extend': {
        this.walk(source, source.node(p.target), scope);
        const inside = this.childScope(scope, scope.owner, undefined, true);
        for (const member of p.members) if (!this.ownership.has(member)) this.walk(source, source.node(member), inside);
        return;
      }
    }
    for (const child of source.children(node.id)) this.walk(source, source.node(child), scope);
  }
}
