import type { InspectionKind, InspectionNode, NodeId, ReferenceResolution } from '../inspection.js';
import { deferredReference, type DeferredReason, type DeferredReference } from './reference.js';
import type { PackageAvailability } from './package-availability.js';
import type { ResolutionProblem } from './problem.js';
import type { Scope, ScopeGraph, Lookup } from './scopes.js';
import type { SourceIndex } from './source-index.js';

const typeKinds: ReadonlySet<InspectionKind> = new Set([
  'concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration',
  'opaque-type-declaration', 'type-parameter', 'builtin-type',
]);
const subjectKinds: ReadonlySet<InspectionKind> = new Set([
  ...typeKinds, 'capability', 'function', 'setup', 'action', 'observation', 'check',
]);
const capabilityKind: ReadonlySet<InspectionKind> = new Set(['capability']);

/** Resolves each authored use in its lexical context; it never loads or rewrites declarations. */
export class ReferenceResolver {
  private readonly hasIncludes: boolean;
  constructor(
    private readonly source: SourceIndex,
    private readonly scopes: ScopeGraph,
    private readonly packages: PackageAvailability,
    private readonly bindings: Map<NodeId, ReferenceResolution>,
    private readonly problems: ResolutionProblem[],
    private readonly deferred: DeferredReference[],
  ) { this.hasIncludes = source.of('include').length > 0; }

  analyze(): void {
    this.ownerContracts();
    this.packagesAndComposition();
    for (const examples of this.source.of('examples')) {
      if (examples.payload.subject) this.resolve(this.source.node(examples.payload.subject) as InspectionNode<'reference'>);
    }
    for (const reference of this.source.of('reference')) {
      if (!this.bindings.has(reference.id)) this.resolve(reference);
    }
  }

  private ownerContracts(): void {
    const constructions = new Map<Scope, InspectionNode>();
    for (const construction of this.source.of('construction')) {
      const scope = this.scopes.scope(construction.id);
      const previous = constructions.get(scope);
      if (previous) this.problems.push({
        code: 'duplicate-declaration', message: 'An owner can declare construction only once.',
        at: construction.origin, related: [previous.origin],
      });
      else constructions.set(scope, construction);
    }
    const publicNames = new Map<Scope, Map<string, InspectionNode>>();
    for (const entry of this.source.of('public')) {
      const scope = this.scopes.scope(entry.id);
      const seen = publicNames.get(scope) ?? new Map<string, InspectionNode>();
      publicNames.set(scope, seen);
      for (const id of entry.payload.references) {
        const reference = this.source.node(id);
        const name = JSON.stringify(this.source.reference(id));
        const previous = seen.get(name);
        if (previous) {
          const problem: ResolutionProblem = {
            code: 'duplicate-declaration', message: 'This public capability is listed more than once.',
            at: reference.origin, related: [previous.origin],
          };
          this.problems.push(problem);
          this.bindings.set(id, { status: 'invalid', problems: [problem] });
        } else seen.set(name, reference);
      }
    }
  }

  private packagesAndComposition(): void {
    for (const requirement of this.source.of('requires-package')) {
      const locator = this.source.node(requirement.payload.locator);
      if (locator.payload.kind !== 'string-literal') throw new Error('A package locator must be a string literal.');
      this.locateFailures(locator, this.packages.check(locator.payload.value, requirement.payload.phase));
    }
    for (const node of this.source.nodes) {
      if (node.payload.kind === 'include' || node.payload.kind === 'extend' || node.payload.kind === 'examples-attachment') {
        this.problems.push({
          code: 'composition-required', message: 'This declaration needs supplied source composition.',
          at: node.origin, related: [],
        });
      }
    }
  }

  private locateFailures(node: InspectionNode, causes: readonly ResolutionProblem[]): readonly ResolutionProblem[] {
    return causes.map(cause => {
      if (cause.code === 'invalid-dependency-input') { this.problems.push(cause); return cause; }
      const problem = { ...cause, at: node.origin, related: [cause.at, ...cause.related] };
      this.problems.push(problem);
      return problem;
    });
  }

  private resolve(reference: InspectionNode<'reference'>): void {
    const parent = this.source.parent(reference.id);
    if (!parent) throw new Error('An inspected reference needs a containing construct.');
    const scope = this.scopes.scope(reference.id);
    const path = this.source.reference(reference.id);
    const instruction = reference.payload.lookup;
    if (instruction) {
      const found = instruction.kind === 'module'
        ? this.scopes.select(instruction.locator, path, scope)
        : instruction.kind === 'builtin' ? this.scopes.builtin(path[0]!) : this.scopes.lookup(scope, path);
      const required = instruction.kind === 'builtin' ? new Set<InspectionKind>(['builtin-type'])
        : instruction.kind === 'type-parameter' ? new Set<InspectionKind>(['type-parameter']) : typeKinds;
      this.accept(reference, path, scope, found, required, instruction.kind === 'module');
      return;
    }
    switch (parent.payload.kind) {
      case 'extend': case 'examples-attachment': this.defer(reference, 'composition'); return;
      case 'member-expression': this.defer(reference, 'receiver-type'); return;
      case 'message': this.defer(reference, 'interaction'); return;
      case 'name-expression':
        if (path[0] === 'result') { this.defer(reference, 'contextual-result'); return; }
        if (this.scopes.hasOrderedName(scope, path[0]!)) { this.defer(reference, 'ordered-scope'); return; }
        this.lookup(reference, path, scope); return;
      case 'named-type': case 'depends-on': this.lookup(reference, path, scope, typeKinds); return;
      case 'examples': this.lookup(reference, path, scope, subjectKinds); return;
      case 'public':
        if (scope.composition) { this.defer(reference, 'composition'); return; }
        this.lookup(reference, path, scope, capabilityKind, true); return;
      default: throw new Error(`Reference owner ${parent.payload.kind} has no resolution rule.`);
    }
  }

  private lookup(reference: InspectionNode<'reference'>, path: readonly string[], scope: Scope,
    required?: ReadonlySet<InspectionKind>, ownOnly = false): void {
    this.accept(reference, path, scope, this.scopes.lookup(scope, path, ownOnly), required);
  }

  private accept(reference: InspectionNode<'reference'>, path: readonly string[], scope: Scope,
    found: Lookup, required?: ReadonlySet<InspectionKind>, moduleLookup = false): void {
    const at = reference.origin;
    let problem: ResolutionProblem;
    switch (found.status) {
      case 'found':
        if (!required || required.has(found.declaration.payload.kind)) {
          this.bindings.set(reference.id, { status: 'bound', target: found.declaration.id });
          return;
        }
        problem = {
          code: 'wrong-reference-kind', message: `${path.join('.')} cannot supply this kind of reference.`,
          at, related: [found.declaration.origin],
        }; break;
      case 'invalid': {
        const problems = moduleLookup ? this.locateFailures(reference, found.problems) : found.problems;
        this.bindings.set(reference.id, { status: 'invalid', problems }); return;
      }
      case 'subject-context': {
        const subject = this.bindings.get(found.subject);
        if (subject?.status === 'invalid') this.bindings.set(reference.id, subject);
        else this.defer(reference, 'composition', 'Examples checking needs the subject scope from source composition.');
        return;
      }
      case 'ambiguous': problem = {
        code: 'ambiguous-reference', message: `${path.join('.')} has multiple explicit introductions.`,
        at, related: found.introductions.map(introduction => introduction.at),
      }; break;
      case 'inaccessible': problem = {
        code: 'inaccessible-reference', message: `${path.join('.')} is not accessible from this scope.`,
        at, related: [found.declaration.origin],
      }; break;
      case 'missing':
        if (!moduleLookup && this.requiresComposition(scope, path)) { this.defer(reference, 'composition'); return; }
        problem = { code: 'unresolved-reference', message: `No visible declaration supplies ${path.join('.')}.`, at, related: [] };
        break;
    }
    this.problems.push(problem);
    this.bindings.set(reference.id, { status: 'invalid', problems: [problem] });
  }

  private requiresComposition(scope: Scope, path: readonly string[]): boolean {
    if (this.hasIncludes || scope.composition) return true;
    for (const extension of this.source.of('extend')) {
      const targetPath = this.source.reference(extension.payload.target);
      const target = this.scopes.lookup(this.scopes.scope(extension.id), targetPath);
      if (target.status === 'found') {
        if (this.scopes.isWithinDeclaration(scope, target.declaration.id)) return true;
        for (let length = 1; length <= path.length; length++) {
          const owner = this.scopes.lookup(scope, path.slice(0, length));
          if (owner.status === 'found' && owner.declaration.id === target.declaration.id) return true;
        }
      } else {
        const count = Math.min(path.length, targetPath.length);
        if (count && path.slice(0, count).every((segment, index) => segment === targetPath[index])) return true;
      }
    }
    return false;
  }

  private defer(reference: InspectionNode<'reference'>, reason: DeferredReason, requires?: string): void {
    const requirement = deferredReference(reference, reason, requires);
    this.deferred.push(requirement);
    this.bindings.set(reference.id, { status: 'deferred', requirement });
  }
}
