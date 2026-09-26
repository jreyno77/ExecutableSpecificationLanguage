import type { InspectionNode } from '../inspection.js';
import type {
  Declaration, DeclarationId, DeclarationKind, DependencySnapshot, NodeId,
  ProblemLocation, ResolutionProblem,
} from './contracts.js';
import { declarationId } from './identity.js';
import { children, copyNodeId, copyRange, nodeKey, SourceIndex } from './source-index.js';

export interface Introduction {
  readonly target?: Declaration;
  readonly problems?: readonly ResolutionProblem[];
  readonly at: ProblemLocation;
  readonly importKey?: string;
}
export class Scope {
  readonly names = new Map<string, Introduction[]>();
  readonly conflicts = new Map<string, readonly ResolutionProblem[]>();
  constructor(
    readonly parent: Scope | undefined,
    readonly owner: DeclarationId | undefined,
    readonly composition = false,
    readonly orderedNames: ReadonlySet<string> = new Set(),
    readonly blockedSubject: NodeId | undefined = undefined,
  ) {}
}
export type Lookup =
  | { readonly status: 'found'; readonly declaration: Declaration }
  | { readonly status: 'missing' }
  | { readonly status: 'inaccessible'; readonly declaration: Declaration }
  | { readonly status: 'subject-context'; readonly subject: NodeId }
  | { readonly status: 'ambiguous'; readonly introductions: readonly Introduction[] }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] };

export function originLocation(declaration: Declaration): ProblemLocation {
  const origin = declaration.origin;
  switch (origin.kind) {
    case 'source': return { kind: 'source', range: origin.range };
    case 'builtin': return { kind: 'builtin', name: origin.name };
    case 'external': return origin;
  }
}
function kindOf(kind: InspectionNode['payload']['kind']): DeclarationKind | undefined {
  switch (kind) {
    case 'record-type-declaration': return 'record-type';
    case 'alias-type-declaration': return 'alias-type';
    case 'opaque-type-declaration': return 'opaque-type';
    case 'concept': case 'component': case 'class': case 'interface':
    case 'capability': case 'function': case 'setup': case 'action': case 'observation': case 'check':
    case 'field': case 'parameter': case 'fixture': case 'participant': return kind;
    default: return undefined;
  }
}

/** Lexical introductions and accessibility, separate from reference-use rules. */
export class SourceScopes {
  readonly root = new Scope(undefined, undefined);
  readonly problems: ResolutionProblem[] = [];
  private readonly scopes = [this.root];
  private readonly nodeScopes = new Map<string, Scope>();
  private readonly members = new Map<DeclarationId, Scope>();
  private readonly privateTo = new Map<DeclarationId, Scope>();
  private readonly externalPrivate = new Set<DeclarationId>();
  private readonly sourceDeclarations: Declaration[] = [];
  private readonly builtinsByName = new Map<string, Declaration>();
  private readonly attachedExamples: { readonly subject: NodeId; readonly members: readonly NodeId[]; readonly scope: Scope }[] = [];

  constructor(private readonly source: SourceIndex, builtins: readonly Declaration[]) {
    for (const builtin of builtins) {
      this.builtinsByName.set(builtin.name, builtin);
      this.introduce(this.root, builtin.name, { target: builtin, at: originLocation(builtin) });
    }
    for (const root of source.roots) this.walk(root, this.root);
  }

  declarations(): readonly Declaration[] {
    return [...this.sourceDeclarations].sort((a, b) =>
      (a.origin.kind === 'source' ? a.origin.node.ordinal : 0) - (b.origin.kind === 'source' ? b.origin.node.ordinal : 0));
  }
  scope(id: NodeId): Scope {
    const scope = this.nodeScopes.get(nodeKey(id));
    if (!scope) throw new Error('Accepted source occurrence has no lexical scope.');
    return scope;
  }
  introduce(scope: Scope, name: string, introduction: Introduction): void {
    const introductions = scope.names.get(name) ?? [];
    introductions.push(introduction);
    scope.names.set(name, introductions);
  }
  addImport(name: string, introduction: Introduction): void { this.introduce(this.root, name, introduction); }

  /** Associate same-source subjects after forward declarations and imports exist. */
  attachExamples(): void {
    for (const examples of this.attachedExamples) {
      const target = this.lookup(examples.scope, this.source.reference(examples.subject));
      const subjectScope = target.status === 'found' && target.declaration.origin.kind === 'source'
        ? this.members.get(target.declaration.id) : undefined;
      const inside = subjectScope
        ? this.childScope(subjectScope)
        : this.childScope(examples.scope, examples.scope.owner, undefined, undefined, examples.subject);
      for (const member of examples.members) this.walk(this.source.node(member), inside);
    }
  }

  /** Only the admitted external contract is available for qualified lookup. */
  addExternal(declarations: readonly Declaration[], dependencies: DependencySnapshot): void {
    for (const declaration of declarations) {
      if (!this.members.has(declaration.id)) this.members.set(declaration.id, new Scope(undefined, declaration.id));
      const origin = declaration.origin;
      if (origin.kind === 'external') {
        const metadata = dependencies.modules.find(module => module.locator === origin.module)
          ?.declarations.find(item => item.id === origin.declaration);
        if (metadata?.local || declaration.kind === 'type-parameter' || declaration.kind === 'parameter') {
          this.externalPrivate.add(declaration.id);
        }
      }
    }
    for (const declaration of declarations) {
      if (declaration.owner) {
        const owner = this.members.get(declaration.owner);
        if (owner) this.introduce(owner, declaration.name, { target: declaration, at: originLocation(declaration) });
      }
    }
  }

  finishIntroductions(): void {
    for (const scope of this.scopes) {
      for (const [name, authored] of scope.names) {
        const builtin = this.builtinsByName.get(name);
        const introductions = builtin && !authored.some(item => item.target === builtin)
          ? [{ target: builtin, at: originLocation(builtin) }, ...authored] : authored;
        if (introductions.length < 2) continue;
        const conflicts: ResolutionProblem[] = [];
        for (let index = 1; index < introductions.length; index++) {
          const current = introductions[index]!;
          const prior = introductions.slice(0, index);
          const duplicate = prior.find(previous => !current.importKey || !previous.importKey
            || current.importKey === previous.importKey || (current.target && current.target === previous.target));
          // Distinct explicit imports are ambiguous at a use; they do not pick
          // an arbitrary winner and are not duplicate local declarations.
          if (!duplicate) continue;
          const problem: ResolutionProblem = {
            code: 'duplicate-declaration', message: `The name ${name} is introduced more than once in this scope.`,
            at: current.at, related: [duplicate.at],
          };
          conflicts.push(problem);
          this.problems.push(problem);
        }
        if (conflicts.length) scope.conflicts.set(name, conflicts);
      }
    }
  }

  lookup(scope: Scope, path: readonly string[], ownOnly = false): Lookup {
    const first = path[0];
    if (first === undefined) return { status: 'missing' };
    let selected: Scope | undefined = scope;
    while (selected && !selected.names.has(first)) {
      if (selected.blockedSubject) {
        // A missing subject may supply a nearer name. Keep block-owned names
        // and unshadowable builtins useful without guessing an outer binding.
        if (this.builtinsByName.has(first)) { selected = this.root; break; }
        return { status: 'subject-context', subject: selected.blockedSubject };
      }
      selected = ownOnly ? undefined : selected.parent;
    }
    if (!selected) return { status: 'missing' };
    let found = this.choose(selected, first, scope);
    for (const segment of path.slice(1)) {
      if (found.status !== 'found') return found;
      const memberScope = this.members.get(found.declaration.id);
      if (!memberScope?.names.has(segment)) return { status: 'missing' };
      found = this.choose(memberScope, segment, scope);
    }
    return found;
  }

  hasOrderedName(scope: Scope, name: string): boolean {
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      if (current.orderedNames.has(name)) return true;
    }
    return false;
  }
  isWithinDeclaration(scope: Scope, declaration: DeclarationId): boolean {
    const inside = this.members.get(declaration);
    return inside !== undefined && this.within(scope, inside);
  }
  private choose(scope: Scope, name: string, from: Scope): Lookup {
    const introductions = scope.names.get(name)!;
    const conflicts = scope.conflicts.get(name);
    if (conflicts?.length) return { status: 'invalid', problems: conflicts };
    const problems = introductions.flatMap(item => item.problems ?? []);
    if (problems.length) return { status: 'invalid', problems };
    const targets = [...new Map(introductions.filter(item => item.target).map(item => [item.target!.id, item.target!])).values()];
    if (targets.length > 1) return { status: 'ambiguous', introductions };
    const declaration = targets[0];
    if (!declaration) return { status: 'missing' };
    const privateScope = this.privateTo.get(declaration.id);
    if (this.externalPrivate.has(declaration.id) || (privateScope && !this.within(from, privateScope))) {
      return { status: 'inaccessible', declaration };
    }
    return { status: 'found', declaration };
  }
  private within(scope: Scope, ancestor: Scope): boolean {
    for (let current: Scope | undefined = scope; current; current = current.parent) if (current === ancestor) return true;
    return false;
  }
  private childScope(parent: Scope, owner = parent.owner, orderedNames: ReadonlySet<string> = new Set(),
    composition = parent.composition, blockedSubject?: NodeId): Scope {
    const scope = new Scope(parent, owner, composition, orderedNames, blockedSubject);
    this.scopes.push(scope);
    return scope;
  }
  private declare(node: InspectionNode, name: string, kind: DeclarationKind, scope: Scope, local: boolean): Declaration {
    const declaration: Declaration = {
      id: declarationId(), name, kind, ...(scope.owner ? { owner: scope.owner } : {}),
      origin: { kind: 'source', node: copyNodeId(node.id), range: copyRange(node.range) },
    };
    this.sourceDeclarations.push(declaration);
    this.introduce(scope, name, { target: declaration, at: originLocation(declaration) });
    if (local) this.privateTo.set(declaration.id, scope);
    return declaration;
  }
  private parameters(ids: readonly NodeId[], scope: Scope): void {
    const names = new Set(ids.map(id => {
      const parameter = this.source.node(id);
      if (parameter.payload.kind !== 'parameter') throw new Error('Accepted parameter list contains a non-parameter.');
      return this.source.name(parameter.payload.name);
    }));
    for (const id of ids) this.walk(this.source.node(id), scope, false, names);
  }
  private walk(node: InspectionNode, scope: Scope, local = false, parameterNames?: ReadonlySet<string>): void {
    this.nodeScopes.set(nodeKey(node.id), scope);
    const p = node.payload;
    switch (p.kind) {
      case 'local': this.walk(this.source.node(p.declaration), scope, true); return;
      case 'concept': case 'component': case 'class': case 'interface': {
        const declaration = this.declare(node, this.source.name(p.name), p.kind, scope, local);
        const inside = this.childScope(scope, declaration.id);
        this.members.set(declaration.id, inside);
        this.walk(this.source.node(p.name), scope);
        for (const member of p.members) this.walk(this.source.node(member), inside);
        return;
      }
      case 'record-type-declaration': case 'alias-type-declaration': case 'opaque-type-declaration': {
        const declaration = this.declare(node, this.source.name(p.name), kindOf(p.kind)!, scope, local);
        const inside = this.childScope(scope, declaration.id);
        this.members.set(declaration.id, inside);
        this.walk(this.source.node(p.name), scope);
        for (const parameter of p.typeParameters) {
          const name = this.source.node(parameter);
          this.nodeScopes.set(nodeKey(parameter), inside);
          this.declare(name, this.source.name(parameter), 'type-parameter', inside, true);
        }
        if (p.kind === 'record-type-declaration') for (const field of p.fields) this.walk(this.source.node(field), inside);
        if (p.kind === 'alias-type-declaration') this.walk(this.source.node(p.targetType), inside);
        return;
      }
      case 'capability': case 'function': case 'setup': case 'action': case 'observation': case 'check': {
        const declaration = this.declare(node, this.source.name(p.name), p.kind, scope, local);
        const inside = this.childScope(scope, declaration.id);
        this.members.set(declaration.id, inside);
        this.walk(this.source.node(p.name), scope);
        this.parameters(p.parameters, inside);
        if (p.returnType) this.walk(this.source.node(p.returnType), inside);
        if (p.body) this.walk(this.source.node(p.body), inside);
        return;
      }
      case 'construction': {
        // A constructor input is a signature parameter, not an implicit field
        // introduced throughout its concept's capabilities.
        this.parameters(p.parameters, this.childScope(scope));
        return;
      }
      case 'parameter': {
        this.declare(node, this.source.name(p.name), 'parameter', scope, true);
        this.walk(this.source.node(p.name), scope);
        this.walk(this.source.node(p.declaredType), scope);
        if (p.defaultValue) this.walk(this.source.node(p.defaultValue), this.childScope(scope, scope.owner, parameterNames));
        return;
      }
      case 'field': case 'fixture': case 'participant':
        this.declare(node, this.source.name(p.name), p.kind, scope, local);
        break;
      case 'examples': {
        if (p.subject) {
          this.walk(this.source.node(p.subject), scope);
          this.attachedExamples.push({ subject: p.subject, members: p.members, scope });
          return;
        }
        const inside = this.childScope(scope);
        for (const member of p.members) this.walk(this.source.node(member), inside);
        return;
      }
      case 'contract-body': case 'helper-body': case 'check-body': {
        const ordered = new Set<string>();
        for (const member of p.members) {
          const child = this.source.node(member);
          if (child.payload.kind === 'let') ordered.add(this.source.name(child.payload.name));
        }
        const inside = this.childScope(scope, scope.owner, ordered);
        for (const member of p.members) this.walk(this.source.node(member), inside);
        return;
      }
      case 'scenario': {
        const ordered = new Set<string>();
        for (const step of p.steps) {
          const child = this.source.node(step);
          if ((child.payload.kind === 'given' || child.payload.kind === 'when' || child.payload.kind === 'then') && child.payload.capture) {
            ordered.add(this.source.name(child.payload.capture));
          }
        }
        const inside = this.childScope(scope, scope.owner, ordered);
        for (const child of children(node)) this.walk(this.source.node(child), inside);
        return;
      }
      case 'interaction': {
        const ordered = new Set<string>();
        for (const member of p.members) {
          const child = this.source.node(member);
          if (child.payload.kind === 'message' && child.payload.capture) ordered.add(this.source.name(child.payload.capture));
        }
        const inside = this.childScope(scope, scope.owner, ordered);
        this.walk(this.source.node(p.title), inside);
        this.parameters(p.parameters, inside);
        for (const member of p.members) this.walk(this.source.node(member), inside);
        return;
      }
      case 'extend': {
        this.walk(this.source.node(p.target), scope);
        const inside = this.childScope(scope, scope.owner, undefined, true);
        for (const member of p.members) this.walk(this.source.node(member), inside);
        return;
      }
    }
    for (const child of children(node)) this.walk(this.source.node(child), scope);
  }
}
