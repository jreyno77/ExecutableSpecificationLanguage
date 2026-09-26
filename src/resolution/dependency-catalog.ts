import type {
  Declaration, DeclarationKind, DependencyDeclaration, DependencyModule, DependencySnapshot,
  PackagePhase, ProblemLocation, ResolutionProblem, ResolutionProblemCode,
} from './contracts.js';
import { declarationId } from './identity.js';

export type ExportResult =
  | { readonly status: 'found'; readonly declaration: Declaration }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] };

type Path = readonly (string | number)[];
interface ModuleEntry {
  readonly input: DependencyModule;
  readonly path: Path;
  readonly declarations: Map<string, Entry>;
  readonly exports: Map<string, ExportEntry>;
  readonly problems: ResolutionProblem[];
}
interface ExportEntry {
  readonly declaration: string;
  readonly path: Path;
  readonly problems: ResolutionProblem[];
}
interface Entry {
  readonly input: DependencyDeclaration;
  readonly module: ModuleEntry;
  readonly path: Path;
  readonly id: Declaration['id'];
  declaration?: Declaration;
}
interface PackageEntry {
  readonly phases: readonly PackagePhase[];
  readonly path: Path;
  readonly problems: ResolutionProblem[];
}
type EntryResult = { readonly entry: Entry } | { readonly problems: readonly ResolutionProblem[] };

const kinds: ReadonlySet<DeclarationKind> = new Set([
  'concept', 'component', 'class', 'interface', 'record-type', 'alias-type', 'opaque-type',
  'type-parameter', 'capability', 'function', 'setup', 'action', 'observation', 'check',
  'field', 'parameter', 'fixture', 'participant',
]);
const location = (path: Path): ProblemLocation => ({ kind: 'dependency', path });

/** Indexes supplied identities; following an export admits only its checked reference closure. */
export class DependencyCatalog {
  private readonly modules = new Map<string, ModuleEntry>();
  private readonly packages = new Map<string, PackageEntry>();
  private readonly builtinNames: ReadonlySet<string>;
  private readonly reported = new Map<string, ResolutionProblem>();
  private readonly admitted = new Map<Declaration['id'], Declaration>();

  constructor(snapshot: DependencySnapshot, builtinDeclarations: readonly Declaration[]) {
    this.builtinNames = new Set(builtinDeclarations.filter(d => d.origin.kind === 'builtin').map(d => d.name));
    snapshot.modules.forEach((module, index) => this.indexModule(module, index));
    for (const module of this.modules.values()) this.checkModule(module);
    snapshot.packages.forEach((entry, index) => this.indexPackage(entry, index));
  }

  get problems(): readonly ResolutionProblem[] { return [...this.reported.values()]; }
  declarations(): Iterable<Declaration> { return [...this.admitted.values()]; }

  export(module: string, path: readonly string[]): ExportResult {
    const found = this.findExport(module, path);
    if ('problems' in found) return { status: 'invalid', problems: found.problems };
    const selected = new Map<Declaration['id'], Entry>();
    const problems: ResolutionProblem[] = [];
    this.collect(found.entry, selected, problems, []);
    if (problems.length) return { status: 'invalid', problems: [...new Set(problems)] };
    for (const entry of selected.values()) this.admitted.set(entry.id, this.describe(entry));
    return { status: 'found', declaration: this.describe(found.entry) };
  }

  package(alias: string, phase?: PackagePhase): readonly ResolutionProblem[] {
    const supplied = this.packages.get(alias);
    if (!supplied) return [this.issue('unavailable-package', `Package ${alias} is not supplied.`, ['packages'])];
    if (supplied.problems.length) return supplied.problems.slice();
    if (phase !== undefined && !supplied.phases.includes(phase)) {
      return [this.issue('unavailable-package', `Package ${alias} is not supplied for ${phase}.`, [...supplied.path, 'phases'])];
    }
    return [];
  }

  private indexModule(input: DependencyModule, index: number): void {
    const path: Path = ['modules', index];
    const module: ModuleEntry = { input, path, declarations: new Map(), exports: new Map(), problems: [] };
    const previous = this.modules.get(input.locator);
    if (previous) {
      const issue = this.issue('invalid-dependency-catalog', `Duplicate module locator ${input.locator}.`, [...path, 'locator'], [location([...previous.path, 'locator'])]);
      previous.problems.push(issue);
      return;
    }
    this.modules.set(input.locator, module);
    input.declarations.forEach((declaration, ordinal) => {
      const entry: Entry = { input: declaration, module, path: [...path, 'declarations', ordinal], id: declarationId() };
      const previous = module.declarations.get(declaration.id);
      if (previous) {
        module.problems.push(this.issue('invalid-dependency-catalog', `Duplicate declaration ID ${declaration.id}.`, [...entry.path, 'id'], [location([...previous.path, 'id'])]));
      } else {
        module.declarations.set(declaration.id, entry);
      }
      if (!kinds.has(declaration.kind)) module.problems.push(this.issue('invalid-dependency-catalog', `Unknown declaration kind ${declaration.kind}.`, [...entry.path, 'kind']));
    });
    input.exports.forEach((selection, ordinal) => {
      const exportPath = [...path, 'exports', ordinal];
      const key = JSON.stringify(selection.path);
      const previous = module.exports.get(key);
      const entry: ExportEntry = previous ?? { declaration: selection.declaration, path: exportPath, problems: [] };
      if (selection.path.length === 0 || selection.path.some(segment => segment.length === 0)) {
        entry.problems.push(this.issue('invalid-dependency-catalog', 'An export path must have nonempty name segments.', [...exportPath, 'path']));
      }
      if (previous) {
        entry.problems.push(this.issue('invalid-dependency-catalog', `Duplicate export path ${key}.`, [...exportPath, 'path'], [location([...previous.path, 'path'])]));
      } else {
        module.exports.set(key, entry);
      }
      if (!module.declarations.has(selection.declaration)) {
        entry.problems.push(this.issue('invalid-dependency-catalog', `Export ${key} names missing declaration ${selection.declaration}.`, [...exportPath, 'declaration']));
      }
    });
  }

  private checkModule(module: ModuleEntry): void {
    for (const entry of module.declarations.values()) this.checkOwnership(entry);
    for (const selection of module.exports.values()) {
      const entry = module.declarations.get(selection.declaration);
      if (!entry) continue;
      const ancestry = new Set<Entry>();
      let current: Entry | undefined = entry;
      while (current && !ancestry.has(current)) {
        ancestry.add(current);
        if (current.input.local) {
          selection.problems.push(this.issue('invalid-dependency-catalog', `Cannot export ${entry.input.name} through local declaration ${current.input.name}.`, [...selection.path, 'declaration'], [location([...current.path, 'local'])]));
          break;
        }
        current = current.input.owner === undefined ? undefined : module.declarations.get(current.input.owner);
      }
    }
  }

  private checkOwnership(entry: Entry): void {
    const seen = new Set<Entry>();
    let current: Entry | undefined = entry;
    while (current?.input.owner !== undefined) {
      seen.add(current);
      const owner: Entry | undefined = current.module.declarations.get(current.input.owner);
      if (!owner) {
        entry.module.problems.push(this.issue('invalid-dependency-catalog', `Missing owner ${current.input.owner} for ${current.input.name}.`, [...current.path, 'owner']));
        return;
      }
      if (seen.has(owner)) {
        entry.module.problems.push(this.issue('invalid-dependency-catalog', `Containment cycle involving ${owner.input.name}.`, [...current.path, 'owner'], [location([...owner.path, 'id'])]));
        return;
      }
      current = owner;
    }
  }

  private indexPackage(input: DependencySnapshot['packages'][number], index: number): void {
    const path: Path = ['packages', index];
    const entry: PackageEntry = { phases: input.phases.slice(), path, problems: [] };
    const previous = this.packages.get(input.alias);
    if (previous) {
      previous.problems.push(this.issue('invalid-dependency-catalog', `Duplicate package alias ${input.alias}.`, [...path, 'alias'], [location([...previous.path, 'alias'])]));
    } else {
      this.packages.set(input.alias, entry);
    }
    const seen = new Map<PackagePhase, number>();
    input.phases.forEach((phase, ordinal) => {
      const earlier = seen.get(phase);
      if (!['build', 'runtime', 'test'].includes(phase)) entry.problems.push(this.issue('invalid-dependency-catalog', `Unknown package phase ${phase}.`, [...path, 'phases', ordinal]));
      else if (earlier !== undefined) entry.problems.push(this.issue('invalid-dependency-catalog', `Duplicate package phase ${phase}.`, [...path, 'phases', ordinal], [location([...path, 'phases', earlier])]));
      seen.set(phase, ordinal);
    });
  }

  private findExport(moduleName: string, path: readonly string[], requestedAt?: Path, chain: readonly ProblemLocation[] = []): EntryResult {
    const module = this.modules.get(moduleName);
    if (!module) return { problems: [this.issue('unavailable-module', `Module ${moduleName} is not supplied.`, requestedAt ?? ['modules'], chain)] };
    const selection = module.exports.get(JSON.stringify(path));
    const invalid = [...module.problems, ...(selection?.problems ?? [])];
    if (invalid.length) return { problems: this.withChain(invalid, requestedAt, chain) };
    if (!selection) return { problems: [this.issue('unresolved-reference', `Module ${moduleName} does not export ${JSON.stringify(path)}.`, requestedAt ?? [...module.path, 'exports'], chain)] };
    // Existence, uniqueness, and local accessibility were checked while indexing the supplied metadata.
    return { entry: module.declarations.get(selection.declaration)! };
  }

  private withChain(problems: readonly ResolutionProblem[], requestedAt: Path | undefined, chain: readonly ProblemLocation[]): readonly ResolutionProblem[] {
    const incoming = requestedAt === undefined ? chain : [...chain, location(requestedAt)];
    if (!incoming.length) return [...new Set(problems)];
    return [...new Set(problems)].map(problem => {
      if (problem.at.kind !== 'dependency') return problem;
      const related = new Map([...problem.related, ...incoming].map(at => [JSON.stringify(at), at]));
      return this.issue(problem.code, problem.message, problem.at.path, [...related.values()]);
    });
  }

  private collect(entry: Entry, selected: Map<Declaration['id'], Entry>, problems: ResolutionProblem[], chain: readonly ProblemLocation[]): void {
    if (selected.has(entry.id)) return;
    selected.set(entry.id, entry);
    if (entry.module.problems.length) {
      problems.push(...entry.module.problems);
      return;
    }
    if (entry.input.owner !== undefined) this.collect(entry.module.declarations.get(entry.input.owner)!, selected, problems, chain);
    entry.input.links.forEach((link, index) => {
      const at: Path = [...entry.path, 'links', index, 'target'];
      switch (link.target.kind) {
        case 'builtin':
          if (!this.builtinNames.has(link.target.name)) problems.push(this.issue('invalid-dependency-catalog', `Link ${link.label} names unavailable builtin ${link.target.name}.`, at, chain));
          break;
        case 'local': {
          const target = entry.module.declarations.get(link.target.declaration);
          if (!target) problems.push(this.issue('invalid-dependency-catalog', `Link ${link.label} names missing declaration ${link.target.declaration}.`, at, chain));
          else this.collect(target, selected, problems, [...chain, location(at)]);
          break;
        }
        case 'import': {
          const target = this.findExport(link.target.module, link.target.path, at, chain);
          if ('problems' in target) {
            problems.push(...target.problems);
            if (target.problems.some(problem => problem.code === 'unavailable-module' || problem.code === 'unresolved-reference')) {
              problems.push(this.issue('invalid-dependency-catalog', `Required link ${link.label} has no available imported declaration.`, at, chain));
            }
          } else this.collect(target.entry, selected, problems, [...chain, location(at)]);
          break;
        }
        default:
          problems.push(this.issue('invalid-dependency-catalog', `Link ${link.label} has an unknown target kind.`, at, chain));
      }
    });
  }

  private describe(entry: Entry): Declaration {
    if (entry.declaration) return entry.declaration;
    entry.declaration = Object.freeze({
      id: entry.id, name: entry.input.name, kind: entry.input.kind,
      ...(entry.input.owner === undefined ? {} : { owner: entry.module.declarations.get(entry.input.owner)!.id }),
      origin: Object.freeze({ kind: 'external' as const, module: entry.module.input.locator, declaration: entry.input.id }),
    });
    return entry.declaration;
  }

  private issue(code: ResolutionProblemCode, message: string, path: Path, related: readonly ProblemLocation[] = []): ResolutionProblem {
    const key = JSON.stringify([code, path, message, related]);
    const existing = this.reported.get(key);
    if (existing) return existing;
    const problem: ResolutionProblem = { code, message, at: location(path), related };
    this.reported.set(key, problem);
    return problem;
  }
}
