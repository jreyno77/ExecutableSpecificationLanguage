import type { Declaration, DeclarationId } from './declaration.js';
import {
  ModuleCatalog, dependencyLocation, dependencyProblem,
  type DependencyPath, type IndexedDeclaration,
} from './dependency-module.js';
import type { ProblemLocation, ResolutionProblem } from './problem.js';

export interface ModuleImport {
  readonly module: string;
  readonly path: readonly string[];
}
export interface ExternalDeclaration {
  readonly declaration: Declaration;
  readonly local: boolean;
}
export type ExportResult =
  | { readonly status: 'found'; readonly declaration: Declaration }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] };
export interface DependencyResolution {
  readonly imports: readonly ExportResult[];
  readonly declarations: readonly ExternalDeclaration[];
  /** Unconditional module metadata findings; request failures stay with their import. */
  readonly problems: readonly ResolutionProblem[];
}

/** Resolves explicit imports to complete required-link closures within supplied modules. */
export class ImportResolver {
  private readonly builtinNames: ReadonlySet<string>;

  constructor(private readonly catalog: ModuleCatalog, builtinDeclarations: readonly Declaration[]) {
    this.builtinNames = new Set(builtinDeclarations.filter(declaration => declaration.origin.kind === 'builtin').map(declaration => declaration.name));
  }

  resolve(requests: readonly ModuleImport[]): DependencyResolution {
    const admitted = new Set<DeclarationId>();
    const imports = requests.map((request): ExportResult => {
      const selected = this.catalog.select(request.module, request.path);
      if (selected.status === 'invalid') return selected;
      const closure = this.requiredDeclarations(selected.entry);
      if (closure.problems.length) return { status: 'invalid', problems: closure.problems };
      for (const id of closure.declarations) admitted.add(id);
      return { status: 'found', declaration: selected.entry.declaration };
    });
    const declarations = this.catalog.declarations
      .filter(entry => admitted.has(entry.declaration.id))
      .map(({ declaration, local }) => ({ declaration, local }));
    return { imports, declarations, problems: [...this.catalog.problems] };
  }

  private requiredLinkProblems(
    problems: readonly ResolutionProblem[], at: DependencyPath, chain: readonly ProblemLocation[],
  ): readonly ResolutionProblem[] {
    return problems.map(problem => {
      if (problem.code === 'unavailable-module' || problem.code === 'unresolved-reference') {
        return { ...problem, at: dependencyLocation(at), related: chain };
      }
      const related = [...new Map([...problem.related, ...chain, dependencyLocation(at)]
        .map(location => [JSON.stringify(location), location])).values()];
      return { ...problem, related };
    });
  }

  /** A failed selection contributes no declarations, including a partially visited owner. */
  private requiredDeclarations(start: IndexedDeclaration): {
    readonly declarations: ReadonlySet<DeclarationId>;
    readonly problems: readonly ResolutionProblem[];
  } {
    const selected = new Set<DeclarationId>();
    const problems: ResolutionProblem[] = [];
    const visit = (entry: IndexedDeclaration, chain: readonly ProblemLocation[]): void => {
      if (selected.has(entry.declaration.id)) return;
      selected.add(entry.declaration.id);
      if (entry.input.owner !== undefined) visit(this.catalog.declaration(entry.module, entry.input.owner)!, chain);
      entry.input.links.forEach((link, index) => {
        const at = [...entry.path, 'links', index, 'target'];
        switch (link.target.kind) {
          case 'builtin':
            if (!this.builtinNames.has(link.target.name)) {
              problems.push(dependencyProblem('invalid-dependency-catalog', `Link ${link.label} names unavailable builtin ${link.target.name}.`, at, chain));
            }
            break;
          case 'local': {
            const target = this.catalog.declaration(entry.module, link.target.declaration);
            if (!target) problems.push(dependencyProblem('invalid-dependency-catalog', `Link ${link.label} names missing declaration ${link.target.declaration}.`, at, chain));
            else visit(target, [...chain, dependencyLocation(at)]);
            break;
          }
          case 'import': {
            const target = this.catalog.select(link.target.module, link.target.path);
            if (target.status === 'invalid') {
              problems.push(...this.requiredLinkProblems(target.problems, at, chain));
              if (target.problems.some(problem => problem.code === 'unavailable-module' || problem.code === 'unresolved-reference')) {
                problems.push(dependencyProblem('invalid-dependency-catalog', `Required link ${link.label} has no available imported declaration.`, at, chain));
              }
            } else visit(target.entry, [...chain, dependencyLocation(at)]);
            break;
          }
          default:
            problems.push(dependencyProblem('invalid-dependency-catalog', `Link ${link.label} has an unknown target kind.`, at, chain));
        }
      });
    };
    visit(start, []);
    return { declarations: selected, problems: [...new Set(problems)] };
  }
}
