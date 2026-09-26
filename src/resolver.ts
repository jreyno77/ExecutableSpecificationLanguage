import type { Inspection, InspectionNode } from './inspection.js';
import type { DeclarationKind } from './resolution/declaration.js';
import { deferredReference, type DeferredReason, type DeferredReference, type ReferenceBinding } from './resolution/reference.js';
import { ImportResolver, type DependencyResolution } from './resolution/import-resolver.js';
import { ModuleCatalog } from './resolution/dependency-module.js';
import type { DependencyModule } from './resolution/dependency-module.js';
import { PackageAvailability, type DependencyPackage } from './resolution/package-availability.js';
import { builtins } from './resolution/builtins.js';
import { ResolutionReport, type Resolution } from './resolution/report.js';
import { originLocation, type ResolutionProblem } from './resolution/problem.js';
import { SourceScopes, type Scope, type NamedImport } from './resolution/scopes.js';
import { copyRange, nodeKey, SourceIndex } from './resolution/source-index.js';

/** Supplied inputs for a single resolution; neither collection implies installation. */
export interface DependencySnapshot {
  readonly modules: readonly DependencyModule[];
  readonly packages: readonly DependencyPackage[];
}

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
  private readonly dependencies: DependencyResolution;
  private readonly packages: PackageAvailability;
  private readonly bindings = new Map<string, ReferenceBinding>();
  private readonly problems: ResolutionProblem[] = [];
  private readonly deferred: DeferredReference[] = [];
  private readonly hasIncludes: boolean;

  constructor(inspection: Inspection, dependencies: DependencySnapshot) {
    this.source = new SourceIndex(inspection);
    this.packages = new PackageAvailability(dependencies.packages);
    const imports = this.imports(new ImportResolver(new ModuleCatalog(dependencies.modules), this.builtinDeclarations));
    this.dependencies = imports.dependencies;
    this.scopes = new SourceScopes(this.source, this.builtinDeclarations, imports.introductions, this.dependencies.declarations);
    this.hasIncludes = this.source.of('include').length > 0;
  }

  report(): Resolution {
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
      [...this.scopes.declarations(), ...this.builtinDeclarations, ...this.dependencies.declarations.map(item => item.declaration)],
      this.source.nodes, this.bindings,
      [...this.problems, ...this.dependencies.problems, ...this.packages.problems], this.deferred,
    );
  }

  private imports(imports: ImportResolver): { dependencies: DependencyResolution; introductions: readonly NamedImport[] } {
    const requests = this.source.of('use').flatMap(use => {
      const locator = this.source.node(use.payload.locator);
      if (locator.payload.kind !== 'string-literal') throw new Error('Accepted use locator is not a string literal.');
      const module = locator.payload.value;
      return use.payload.imports.map(id => {
        const item = this.source.node(id);
        if (item.payload.kind !== 'import-item') throw new Error('Accepted use contains a non-import item.');
        const reference = this.source.node(item.payload.imported);
        const path = this.source.reference(reference.id);
        return {
          module, path, reference,
          name: item.payload.alias ? this.source.name(item.payload.alias) : path.at(-1)!,
          at: { kind: 'source' as const, range: copyRange(item.range) },
          importKey: JSON.stringify([module, path]),
        };
      });
    });
    const dependencies = imports.resolve(requests);
    const introductions: NamedImport[] = requests.map((request, index) => {
      const found = dependencies.imports[index]!;
      const { name, at, importKey, reference } = request;
      if (found.status === 'found') {
        this.bindings.set(nodeKey(reference.id), { status: 'bound', target: found.declaration.id });
        return { name, target: found.declaration, at, importKey };
      }
      const problems = this.locateDependencyFailure(reference, found.problems);
      this.bindings.set(nodeKey(reference.id), { status: 'invalid', problems });
      return { name, problems, at, importKey };
    });
    return { dependencies, introductions };
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
      this.locateDependencyFailure(locator, this.packages.check(locator.payload.value, requirement.payload.phase));
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

  private locateDependencyFailure(node: InspectionNode, causes: readonly ResolutionProblem[]): readonly ResolutionProblem[] {
    return causes.map(cause => {
      if (cause.code === 'invalid-dependency-catalog') {
        this.problems.push(cause);
        return cause;
      }
      const problem: ResolutionProblem = {
        code: cause.code, message: cause.message, at: { kind: 'source', range: copyRange(node.range) },
        related: [cause.at, ...cause.related],
      };
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
    const requirement = deferredReference(reference, reason, requires);
    this.deferred.push(requirement);
    this.bindings.set(nodeKey(reference.id), { status: 'deferred', requirement });
  }
}
