import type { BuiltinName } from './builtins.js';
import { declarationId, declarationKinds, type Declaration, type DeclarationId, type DeclarationKind } from './declaration.js';
import type { ProblemLocation, ResolutionProblem, ResolutionProblemCode } from './problem.js';

export type DependencyTarget =
  | { readonly kind: 'local'; readonly declaration: string }
  | { readonly kind: 'import'; readonly module: string; readonly path: readonly string[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };

/** A required identity link, not an executable type or callable schema. */
export interface DependencyLink {
  readonly label: string;
  readonly target: DependencyTarget;
}
export interface DependencyDeclaration {
  readonly id: string;
  readonly name: string;
  readonly kind: Exclude<DeclarationKind, 'builtin-type'>;
  readonly owner?: string;
  readonly local?: boolean;
  readonly links: readonly DependencyLink[];
}
export interface DependencyModule {
  readonly locator: string;
  readonly declarations: readonly DependencyDeclaration[];
  readonly exports: readonly { readonly path: readonly string[]; readonly declaration: string }[];
}

export type DependencyPath = readonly (string | number)[];
export interface IndexedDeclaration {
  readonly input: DependencyDeclaration;
  readonly module: string;
  readonly path: DependencyPath;
  readonly declaration: Declaration;
  /** External parameters are lexical declarations even without an explicit local flag. */
  readonly local: boolean;
}
interface ExportSelection {
  readonly declaration: string;
  readonly path: DependencyPath;
  readonly problems: ResolutionProblem[];
}
export type ModuleSelection =
  | { readonly status: 'found'; readonly entry: IndexedDeclaration }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] };

export function dependencyLocation(path: DependencyPath): ProblemLocation {
  return { kind: 'dependency', path };
}
export function dependencyProblem(
  code: ResolutionProblemCode, message: string, path: DependencyPath,
  related: readonly ProblemLocation[] = [],
): ResolutionProblem {
  return { code, message, at: dependencyLocation(path), related };
}

/** One module's declarations, ownership and advertised selections; no link traversal. */
class IndexedModule {
  readonly declarations = new Map<string, IndexedDeclaration>();
  readonly exports = new Map<string, ExportSelection>();
  readonly problems: ResolutionProblem[] = [];
  readonly path: DependencyPath;

  constructor(readonly locator: string, input: DependencyModule, index: number) {
    this.path = ['modules', index];
    const headers = new Map<string, { input: DependencyDeclaration; path: DependencyPath; id: DeclarationId }>();
    input.declarations.forEach((declaration, ordinal) => {
      const path = [...this.path, 'declarations', ordinal];
      const previous = headers.get(declaration.id);
      if (previous) {
        this.problems.push(dependencyProblem('invalid-dependency-catalog', `Duplicate declaration ID ${declaration.id}.`, [...path, 'id'], [dependencyLocation([...previous.path, 'id'])]));
      } else {
        headers.set(declaration.id, { input: declaration, path, id: declarationId() });
      }
      if (!(declarationKinds as readonly string[]).includes(declaration.kind)) {
        this.problems.push(dependencyProblem('invalid-dependency-catalog', `Unknown declaration kind ${declaration.kind}.`, [...path, 'kind']));
      }
    });
    for (const header of headers.values()) {
      const input = header.input;
      const owner = input.owner === undefined ? undefined : headers.get(input.owner)?.id;
      const declaration: Declaration = Object.freeze({
        id: header.id, name: input.name, kind: input.kind,
        ...(owner === undefined ? {} : { owner }),
        origin: Object.freeze({ kind: 'external' as const, module: locator, declaration: input.id }),
      });
      this.declarations.set(input.id, {
        input, module: locator, path: header.path, declaration,
        local: input.local === true || input.kind === 'parameter' || input.kind === 'type-parameter',
      });
    }
    const reportedOwnerEdges = new Set<IndexedDeclaration>();
    for (const entry of this.declarations.values()) this.checkOwnership(entry, reportedOwnerEdges);
    input.exports.forEach((selection, ordinal) => this.indexExport(selection, ordinal));
  }

  private checkOwnership(entry: IndexedDeclaration, reported: Set<IndexedDeclaration>): void {
    const seen = new Set<IndexedDeclaration>();
    let current = entry;
    while (current.input.owner !== undefined) {
      seen.add(current);
      const owner = this.declarations.get(current.input.owner);
      if (!owner) {
        if (reported.has(current)) return;
        reported.add(current);
        this.problems.push(dependencyProblem('invalid-dependency-catalog', `Missing owner ${current.input.owner} for ${current.input.name}.`, [...current.path, 'owner']));
        return;
      }
      if (seen.has(owner)) {
        if (reported.has(current)) return;
        reported.add(current);
        this.problems.push(dependencyProblem('invalid-dependency-catalog', `Containment cycle involving ${owner.input.name}.`, [...current.path, 'owner'], [dependencyLocation([...owner.path, 'id'])]));
        return;
      }
      current = owner;
    }
  }

  private indexExport(selection: DependencyModule['exports'][number], ordinal: number): void {
    const path = [...this.path, 'exports', ordinal];
    const key = JSON.stringify(selection.path);
    const previous = this.exports.get(key);
    const entry = previous ?? { declaration: selection.declaration, path, problems: [] };
    if (selection.path.length === 0 || selection.path.some(segment => segment.length === 0)) {
      entry.problems.push(dependencyProblem('invalid-dependency-catalog', 'An export path must have nonempty name segments.', [...path, 'path']));
    }
    if (previous) {
      entry.problems.push(dependencyProblem('invalid-dependency-catalog', `Duplicate export path ${key}.`, [...path, 'path'], [dependencyLocation([...previous.path, 'path'])]));
    } else {
      this.exports.set(key, entry);
    }
    const declaration = this.declarations.get(selection.declaration);
    if (!declaration) {
      entry.problems.push(dependencyProblem('invalid-dependency-catalog', `Export ${key} names missing declaration ${selection.declaration}.`, [...path, 'declaration']));
      return;
    }
    const ancestors = new Set<IndexedDeclaration>();
    let current: IndexedDeclaration | undefined = declaration;
    while (current && !ancestors.has(current)) {
      ancestors.add(current);
      if (current.input.local) {
        entry.problems.push(dependencyProblem('invalid-dependency-catalog', `Cannot export ${declaration.input.name} through local declaration ${current.input.name}.`, [...path, 'declaration'], [dependencyLocation([...current.path, 'local'])]));
        return;
      }
      current = current.input.owner === undefined ? undefined : this.declarations.get(current.input.owner);
    }
  }
}

/** Validates module identities once and answers selections without accumulating query state. */
export class ModuleCatalog {
  private readonly modules = new Map<string, IndexedModule>();
  readonly problems: readonly ResolutionProblem[];
  readonly declarations: readonly IndexedDeclaration[];

  constructor(inputs: readonly DependencyModule[]) {
    inputs.forEach((input, index) => {
      const previous = this.modules.get(input.locator);
      if (previous) {
        previous.problems.push(dependencyProblem('invalid-dependency-catalog', `Duplicate module locator ${input.locator}.`, ['modules', index, 'locator'], [dependencyLocation([...previous.path, 'locator'])]));
      } else {
        this.modules.set(input.locator, new IndexedModule(input.locator, input, index));
      }
    });
    this.problems = [...new Set([...this.modules.values()].flatMap(module =>
      [...module.problems, ...[...module.exports.values()].flatMap(selection => selection.problems)]))];
    const ordered = [...this.modules.values()].sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0);
    this.declarations = ordered.flatMap(module => [...module.declarations.values()]);
  }

  declaration(moduleName: string, id: string): IndexedDeclaration | undefined {
    return this.modules.get(moduleName)?.declarations.get(id);
  }

  select(moduleName: string, path: readonly string[]): ModuleSelection {
    const module = this.modules.get(moduleName);
    if (!module) return { status: 'invalid', problems: [dependencyProblem('unavailable-module', `Module ${moduleName} is not supplied.`, ['modules'])] };
    const selection = module.exports.get(JSON.stringify(path));
    const invalid = [...module.problems, ...(selection?.problems ?? [])];
    if (invalid.length) return { status: 'invalid', problems: [...new Set(invalid)] };
    if (!selection) return { status: 'invalid', problems: [dependencyProblem('unresolved-reference', `Module ${moduleName} does not export ${JSON.stringify(path)}.`, [...module.path, 'exports'])] };
    // The constructor has checked the selected identity and its export accessibility.
    return { status: 'found', entry: module.declarations.get(selection.declaration)! };
  }
}
