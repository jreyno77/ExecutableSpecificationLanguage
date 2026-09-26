import type { Inspection } from './inspection.js';
import type { InspectionNode } from './inspection.js';
import type {
  Declaration, DeclarationKind, DeferredReason, DeferredReference, DependencySnapshot, ReferenceBinding,
  Resolution, ResolutionProblem,
} from './resolution/contracts.js';
import { DependencyCatalog } from './resolution/dependency-catalog.js';
import { builtins } from './resolution/identity.js';
import { ResolutionReport } from './resolution/report.js';
import { originLocation, SourceScopes, type Scope } from './resolution/scopes.js';
import { copyNodeId, copyRange, nodeKey, SourceIndex } from './resolution/source-index.js';

const typeKinds: ReadonlySet<DeclarationKind> = new Set([
  'concept', 'component', 'class', 'interface', 'record-type', 'alias-type', 'opaque-type', 'type-parameter', 'builtin-type',
]);
const subjectKinds: ReadonlySet<DeclarationKind> = new Set([
  ...typeKinds, 'capability', 'function', 'setup', 'action', 'observation', 'check',
]);
const capabilityKind: ReadonlySet<DeclarationKind> = new Set(['capability']);

/** Resolve supplied source and metadata without loading, executing, or retaining a provider. */
export class Resolver {
  resolve(inspection: Inspection, dependencies: DependencySnapshot): Resolution {
    return new SourceResolution(inspection, dependencies).report();
  }
}

class SourceResolution {
  private readonly source: SourceIndex;
  private readonly builtinDeclarations = builtins();
  private readonly scopes: SourceScopes;
  private readonly catalog: DependencyCatalog;
  private readonly bindings = new Map<string, ReferenceBinding>();
  private readonly problems: ResolutionProblem[] = [];
  private readonly deferred: DeferredReference[] = [];
  private readonly locatedCatalogCauses = new Set<ResolutionProblem>();
  private readonly hasIncludes: boolean;

  constructor(inspection: Inspection, private readonly dependencies: DependencySnapshot) {
    this.source = new SourceIndex(inspection);
    this.scopes = new SourceScopes(this.source, this.builtinDeclarations);
    this.catalog = new DependencyCatalog(dependencies, this.builtinDeclarations);
    this.hasIncludes = this.source.of('include').length > 0;
  }

  report(): Resolution {
    this.imports();
    this.scopes.addExternal([...this.catalog.declarations()], this.dependencies);
    this.scopes.attachExamples();
    this.scopes.finishIntroductions();
    this.problems.push(...this.scopes.problems);
    this.ownerContracts();
    this.packagesAndComposition();
    // Bodies can retain the subject's actual failure instead of guessing an
    // unrelated lexical target when the subject scope is unavailable.
    for (const examples of this.source.of('examples')) {
      if (examples.payload.subject) this.resolve(this.source.node(examples.payload.subject) as InspectionNode<'reference'>);
    }
    for (const reference of this.source.of('reference')) {
      if (!this.bindings.has(nodeKey(reference.id))) this.resolve(reference);
    }
    return new ResolutionReport(
      [...this.scopes.declarations(), ...this.builtinDeclarations, ...this.externalDeclarations()],
      this.source.nodes, this.bindings,
      [...this.problems, ...this.catalog.problems.filter(problem => !this.locatedCatalogCauses.has(problem))], this.deferred,
    );
  }

  private externalDeclarations(): readonly Declaration[] {
    const admitted = new Map<string, Declaration>();
    for (const declaration of this.catalog.declarations()) {
      if (declaration.origin.kind === 'external') {
        admitted.set(JSON.stringify([declaration.origin.module, declaration.origin.declaration]), declaration);
      }
    }
    const ordered: Declaration[] = [];
    const modules = [...this.dependencies.modules].sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0);
    for (const module of modules) {
      for (const input of module.declarations) {
        const key = JSON.stringify([module.locator, input.id]);
        const declaration = admitted.get(key);
        if (declaration) { ordered.push(declaration); admitted.delete(key); }
      }
    }
    return ordered;
  }

  private imports(): void {
    for (const use of this.source.of('use')) {
      const locator = this.source.node(use.payload.locator);
      if (locator.payload.kind !== 'string-literal') throw new Error('Accepted use locator is not a string literal.');
      for (const id of use.payload.imports) {
        const item = this.source.node(id);
        if (item.payload.kind !== 'import-item') throw new Error('Accepted use contains a non-import item.');
        const reference = this.source.node(item.payload.imported);
        const path = this.source.reference(reference.id);
        const name = item.payload.alias ? this.source.name(item.payload.alias) : path.at(-1)!;
        const found = this.catalog.export(locator.payload.value, path);
        const at = { kind: 'source' as const, range: copyRange(item.range) };
        const importKey = JSON.stringify([locator.payload.value, path]);
        if (found.status === 'found') {
          this.scopes.addImport(name, { target: found.declaration, at, importKey });
          this.bindings.set(nodeKey(reference.id), { status: 'bound', target: found.declaration.id });
        } else {
          const problems = this.locateCatalogFailure(reference, found.problems);
          this.scopes.addImport(name, { problems, at, importKey });
          this.bindings.set(nodeKey(reference.id), { status: 'invalid', problems });
        }
      }
    }
  }

  private ownerContracts(): void {
    const constructions = new Map<Scope, InspectionNode>();
    for (const construction of this.source.of('construction')) {
      const scope = this.scopes.scope(construction.id);
      const previous = constructions.get(scope);
      if (previous) this.problems.push({
        code: 'duplicate-declaration', message: 'An owner can declare construction only once.',
        at: { kind: 'source', range: copyRange(construction.range) },
        related: [{ kind: 'source', range: copyRange(previous.range) }],
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
            at: { kind: 'source', range: copyRange(reference.range) },
            related: [{ kind: 'source', range: copyRange(previous.range) }],
          };
          this.problems.push(problem);
          this.bindings.set(nodeKey(id), { status: 'invalid', problems: [problem] });
        } else seen.set(name, reference);
      }
    }
  }

  private packagesAndComposition(): void {
    for (const requirement of this.source.of('requires-package')) {
      const locator = this.source.node(requirement.payload.locator);
      if (locator.payload.kind !== 'string-literal') throw new Error('Accepted package locator is not a string literal.');
      this.locateCatalogFailure(locator, this.catalog.package(locator.payload.value, requirement.payload.phase));
    }
    for (const node of this.source.nodes) {
      if (node.payload.kind === 'include' || node.payload.kind === 'extend' || node.payload.kind === 'examples-attachment') {
        this.problems.push({
          code: 'composition-required', message: 'This declaration requires supplied source composition before its combined meaning is available.',
          at: { kind: 'source', range: copyRange(node.range) }, related: [],
        });
      }
    }
  }

  private locateCatalogFailure(node: InspectionNode, causes: readonly ResolutionProblem[]): readonly ResolutionProblem[] {
    return causes.map(cause => {
      if (cause.code === 'invalid-dependency-catalog') return cause;
      const problem: ResolutionProblem = {
        code: cause.code, message: cause.message, at: { kind: 'source', range: copyRange(node.range) },
        related: [cause.at, ...cause.related],
      };
      this.locatedCatalogCauses.add(cause);
      this.problems.push(problem);
      return problem;
    });
  }

  private resolve(reference: InspectionNode<'reference'>): void {
    const parent = this.source.parent(reference.id);
    if (!parent) throw new Error('Accepted reference has no syntactic owner.');
    const scope = this.scopes.scope(reference.id);
    const path = this.source.reference(reference.id);
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
      default: throw new Error(`Accepted reference has unsupported syntactic owner ${parent.payload.kind}.`);
    }
  }

  private lookup(reference: InspectionNode<'reference'>, path: readonly string[], scope: Scope,
    requiredKinds?: ReadonlySet<DeclarationKind>, ownOnly = false): void {
    const found = this.scopes.lookup(scope, path, ownOnly);
    const at = { kind: 'source' as const, range: copyRange(reference.range) };
    let problem: ResolutionProblem;
    switch (found.status) {
      case 'found':
        if (!requiredKinds || requiredKinds.has(found.declaration.kind)) {
          this.bindings.set(nodeKey(reference.id), { status: 'bound', target: found.declaration.id });
          return;
        }
        problem = {
          code: 'wrong-reference-kind', message: `The declaration ${path.join('.')} has kind ${found.declaration.kind}, which cannot satisfy this reference.`,
          at, related: [originLocation(found.declaration)],
        };
        break;
      case 'invalid': this.bindings.set(nodeKey(reference.id), { status: 'invalid', problems: found.problems }); return;
      case 'subject-context': {
        const subject = this.bindings.get(nodeKey(found.subject));
        if (!subject) throw new Error('An examples subject must be resolved before its dependent references.');
        if (subject.status === 'invalid') this.bindings.set(nodeKey(reference.id), subject);
        else this.defer(reference, 'composition', 'Examples checking needs the subject scope; supplied declaration metadata does not provide an authored examples context.');
        return;
      }
      case 'ambiguous': problem = {
        code: 'ambiguous-reference', message: `The reference ${path.join('.')} has multiple explicit introductions.`,
        at, related: found.introductions.map(introduction => introduction.at),
      }; break;
      case 'inaccessible': problem = {
        code: 'inaccessible-reference', message: `The declaration ${path.join('.')} is local to another scope.`,
        at, related: [originLocation(found.declaration)],
      }; break;
      case 'missing':
        if (this.requiresComposition(scope, path)) { this.defer(reference, 'composition'); return; }
        problem = { code: 'unresolved-reference', message: `No visible declaration supplies ${path.join('.')}.`, at, related: [] };
        break;
    }
    this.problems.push(problem);
    this.bindings.set(nodeKey(reference.id), { status: 'invalid', problems: [problem] });
  }

  private requiresComposition(scope: Scope, path: readonly string[]): boolean {
    if (this.hasIncludes || scope.composition) return true;
    for (const extension of this.source.of('extend')) {
      const targetPath = this.source.reference(extension.payload.target);
      const target = this.scopes.lookup(this.scopes.scope(extension.id), targetPath);
      if (target.status === 'found') {
        if (this.scopes.isWithinDeclaration(scope, target.declaration.id)) return true;
        // A qualified lookup can reach the same owner through an import alias.
        for (let length = 1; length <= path.length; length++) {
          const owner = this.scopes.lookup(scope, path.slice(0, length));
          if (owner.status === 'found' && owner.declaration.id === target.declaration.id) return true;
        }
      } else {
        const sharedLength = Math.min(path.length, targetPath.length);
        if (sharedLength > 0 && path.slice(0, sharedLength).every((segment, index) => segment === targetPath[index])) return true;
      }
    }
    return false;
  }

  private defer(reference: InspectionNode<'reference'>, reason: DeferredReason, requires?: string): void {
    const required: Record<DeferredReason, string> = {
      'receiver-type': 'Expression typing must identify the receiver and its available members.',
      'contextual-result': 'Contract checking must establish whether a result is available in this context.',
      'ordered-scope': 'Helper, scenario, or default checking must establish ordered local and capture visibility.',
      composition: 'Source composition must supply the declarations and ownership of the combined document.',
      interaction: 'Interaction checking must identify participants and select the recipient operation.',
    };
    const requirement: DeferredReference = {
      occurrence: copyNodeId(reference.id), range: copyRange(reference.range), reason, requires: requires ?? required[reason],
    };
    this.deferred.push(requirement);
    this.bindings.set(nodeKey(reference.id), { status: 'deferred', requirement });
  }
}
