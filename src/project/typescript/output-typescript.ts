import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { visit } from 'jsonc-parser';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from '../output/output.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ArtifactAssociation, IdentityRecord } from '../../model/specification-identity.js';
import type { FileChange } from '../connection/project-writer.js';
import { canonical, identifier, locatorSchema, success } from '../../model/identity-baseline.js';
import { hash, literal } from '../connection/project-files.js';
import { validDiff } from '../output/output-contract.js';
import { outputProblem } from '../output/output-documents.js';
import { TypeScriptProject } from './typescript-project.js';
import { TypeScriptDeclarations, typescriptOptions, type TypeScriptOptions } from './typescript-declarations.js';
import { TypeScriptPreservation } from './typescript-preservation.js';

const association = z.strictObject({ specId: identifier, locator: locatorSchema });
const stateSchema = z.strictObject({ format: z.literal(1), renderFormat: z.literal(1), outputId: z.literal('typescript'), options: z.string(),
  files: z.array(z.strictObject({ id: identifier, path: z.string(), generated: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), artifacts: z.array(association).min(1),
    renderedArtifacts: z.array(association).min(1).optional(), adopted: z.array(identifier).optional(), documentation: z.array(identifier).optional(), confirmed: z.string().regex(/^[a-f0-9]{64}$/).optional() })), deleted: z.array(identifier) });
type State = z.infer<typeof stateSchema>;
const statePath = '.expec/outputs/' + Buffer.from('typescript').toString('hex') + '.json';
const refused = (problems: readonly Diagnostic[]): Check<OutputPlan> => ({ problems, deferred: [] });
const key = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const conflict = (path: string, text: string) => outputProblem('output-conflict', path, text);

export const typescriptOutput: OutputRegistration = {
  id: 'typescript', validate: options => {
    const result = typescriptOptions.safeParse(options);
    return result.success ? [] : result.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message }));
  },
  open: (options, context) => new TypeScriptOutput(typescriptOptions.parse(options), context),
};

const renderingOptions = (options: TypeScriptOptions) => { const { adoptExisting: _permission, ...rendering } = options; return canonical(rendering); };

/** Coordinates native projection, preservation ownership and a guarded project write plan. */
class TypeScriptOutput implements OutputAdapter {
  readonly id = 'typescript';
  private queryProject: { associations: readonly ArtifactAssociation[]; project: TypeScriptProject } | undefined;
  constructor(private readonly options: TypeScriptOptions, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot, request?: OutputRequest): { value?: State; problems: Diagnostic[] } {
    const file = snapshot.files.find(file => file.path === statePath);
    if (!file) return { problems: [] };
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes), objects: Set<string>[] = [];
      visit(text, { onObjectBegin: () => { objects.push(new Set()); }, onObjectEnd: () => { objects.pop(); }, onObjectProperty: name => {
        if (objects.at(-1)!.has(name)) throw new Error('Duplicate ownership property'); objects.at(-1)!.add(name);
      } });
      const data = JSON.parse(text);
      if (data?.renderFormat !== 1) return { problems: [outputProblem('output-options-changed', statePath, 'Recorded native render format requires an explicit migration.')] };
      const state = stateSchema.parse(data), settings = typescriptOptions.parse(JSON.parse(state.options)), roots = state.files.map(file => file.id), ids = state.files.flatMap(file => file.artifacts.map(item => item.specId));
      if (new Set(roots).size !== roots.length || new Set(state.deleted).size !== state.deleted.length
        || state.deleted.some(id => ids.includes(id)) || state.files.some(file => !literal(file.path) || !file.adopted?.length && (settings.directory !== '.' && !file.path.startsWith(settings.directory + '/') || file.path.split('/').some(part => part.toLowerCase() === '.expec')) || !file.path.endsWith('.ts')
          || Buffer.from(file.generated).toString('utf8') !== file.generated || hash(Buffer.from(file.generated)) !== file.hash
          || file.adopted?.some(id => !file.artifacts.some(item => item.specId === id)) || file.adopted?.length && !file.renderedArtifacts
          || state.files.some(other => other !== file && key(other.path) === key(file.path) && (other.path !== file.path || other.confirmed !== file.confirmed))
          || !file.artifacts.some(item => item.specId === file.id) || file.artifacts.some(item => item.locator.outputId !== this.id
            || item.locator.format !== 'typescript-symbol-1' || (item.locator.value as { file: string }).file !== file.path))) throw new Error('Invalid generation baseline');
      this.project(state);
      this.project({ ...state, files: state.files.map(file => ({ ...file, artifacts: file.renderedArtifacts ?? file.artifacts })) });
      const represented = (items: readonly ArtifactAssociation[]) => canonical(items.map(item => ({ id: item.specId,
        kinds: (item.locator.value as { declaration: { kind: string }[] }).declaration.map(part => part.kind) })).sort((a, b) => canonical(a).localeCompare(canonical(b))));
      if (state.files.some(file => represented(file.artifacts) !== represented(file.renderedArtifacts ?? file.artifacts)
        || file.documentation?.some(id => !file.artifacts.some(item => item.specId === id)))) throw new Error('Invalid rendered associations');
      return { value: state, problems: renderingOptions(settings) === renderingOptions(this.options) || this.additionalImports(settings, request) ? [] : [outputProblem('output-options-changed', statePath, 'Native output options require an explicit migration.')] };
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Recorded generated text, byte hash or native associations are invalid.')] }; }
  }
  private additionalImports(previous: TypeScriptOptions, request?: OutputRequest): boolean {
    if (request?.operation !== 'update' || !validDiff(request.diff, request.current)
      || renderingOptions({ ...this.options, imports: previous.imports }) !== renderingOptions(previous)
      || canonical(this.options.imports.slice(0, previous.imports.length)) !== canonical(previous.imports)) return false;
    const extra = this.options.imports.slice(previous.imports.length);
    if (!extra.length) return false;
    const current = new Map(request.current.baseline.elements.map(record => [record.id, record])), before = new Map(current), added = new Set<string>();
    for (const change of request.diff.changes) {
      if (change.before) before.set(change.id, change.before);
      else { before.delete(change.id); added.add(change.id); }
    }
    const selected = (rule: TypeScriptOptions['imports'][number], records: ReadonlyMap<string, IdentityRecord>): string | undefined => {
      const path = (record: IdentityRecord): string[] => [...record.address.owner ? path(records.get(record.address.owner)!) : [], record.address.name ?? record.address.kind];
      const matches = [...records.values()].filter(record => (rule.module === undefined || record.address.module === rule.module)
        && canonical(path(record)) === canonical(rule.declaration));
      return matches.length === 1 ? matches[0]!.id : undefined;
    };
    return previous.imports.every(rule => { const id = selected(rule, before); return id !== undefined && id === selected(rule, current); })
      && extra.every(rule => { const id = selected(rule, current); return id !== undefined && added.has(id); });
  }
  private project(state?: State, retain = false): TypeScriptProject {
    const associations = state?.files.flatMap(file => file.artifacts) ?? [];
    if (retain && this.queryProject && isDeepStrictEqual(this.queryProject.associations, associations)) return this.queryProject.project;
    const project = new TypeScriptProject({ outputId: this.id, ...this.options.configFile ? { configFile: this.options.configFile } : {} }, associations);
    if (retain) this.queryProject = { associations: structuredClone(associations), project };
    return project;
  }
  async readAll(ids: readonly string[], snapshot: ProjectSnapshot) {
    if (!ids.length) return [];
    const state = this.state(snapshot);
    return this.project(state.value, true).readAll(ids, snapshot).map(result => {
      const problems = [...result.problems, ...structuredClone(state.problems)];
      return { ...result, problems, coverage: { ...result.coverage, complete: !problems.length && result.coverage.complete,
        limitations: [...result.coverage.limitations, ...state.problems.map(problem => problem.message)] } };
    });
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    return (await this.readAll([id], snapshot))[0]!;
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const state = this.state(snapshot), result = this.project(state.value, true).search(id, snapshot), problems = [...result.problems, ...state.problems];
    const cover = (direction: 'incoming' | 'outgoing') => ({ ...result[direction], coverage: { ...result[direction].coverage,
      complete: !problems.length && result[direction].coverage.complete, limitations: [...result[direction].coverage.limitations, ...state.problems.map(problem => problem.message)] } });
    return { ...result, incoming: cover('incoming'), outgoing: cover('outgoing'), problems };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return refused([...snapshot.problems, outputProblem('incomplete-project', '', 'A complete captured project is required.')]);
    if (new Set(snapshot.files.map(file => key(file.path))).size !== snapshot.files.length || snapshot.files.some(file => !literal(file.path) || !(file.bytes instanceof Uint8Array) || hash(file.bytes) !== file.version)) return refused([outputProblem('invalid-project-snapshot', '', 'Captured paths and byte versions must be valid and unique.')]);
    const stored = this.state(snapshot, request); if (stored.problems.length) return refused(stored.problems);
    const previous = stored.value, problems: Diagnostic[] = [];
    for (const file of previous?.files ?? []) if (!snapshot.files.some(current => current.path === file.path)) problems.push(conflict(file.path, 'The recorded generated file is missing.'));
    if (problems.length) return refused(problems);
    let next: State;
    if (request.operation === 'delete') {
      const owner = previous?.files.find(file => file.artifacts.some(item => item.specId === request.id));
      if (!previous || !owner && !previous.deleted.includes(request.id)) return refused([outputProblem('output-not-found', '', 'No owned native declaration exists for ' + request.id)]);
      if (owner && owner.id !== request.id) return refused([outputProblem('nested-delete', owner.path, 'Remove nested members through a specification update.')]);
      next = { ...previous, files: previous.files.filter(file => file !== owner), deleted: [...new Set([...previous.deleted, ...owner?.artifacts.map(item => item.specId) ?? []])].sort() };
    } else {
      const current = request.current;
      if (!current?.specification?.inspection || typeof current.id !== 'function' || typeof current.node !== 'function' || !current.baseline) throw new TypeError('Provide a successfully identified specification.');
      const known = new Set([...current.baseline.elements.map(item => item.id), ...current.baseline.retired]);
      if (previous && [...previous.deleted, ...previous.files.flatMap(file => file.artifacts.map(item => item.specId))].some(id => !known.has(id))) return refused([outputProblem('unknown-output-identity', statePath, 'Current identity does not recognize earlier output subjects.')]);
      if ('diff' in request && !validDiff(request.diff, current)) return refused([outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identity facts.')]);
      if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')))) return refused([outputProblem('not-addition-only', '', 'Use update when existing contracts change.')]);
      const placements = new Map<string, ArtifactAssociation>();
      if (this.options.sourceRoot !== undefined) {
        for (const file of previous?.files ?? []) if (file.adopted?.length) placements.set(file.id, file.artifacts.find(item => item.specId === file.id)!);
        for (const item of current.baseline.artifacts) {
          if (item.locator.outputId !== this.id || item.locator.format !== 'typescript-symbol-1') continue;
          const at = item.locator.value as { declaration: unknown[] };
          if (at.declaration.length === 1 && !previous?.files.some(file => file.id === item.specId)) placements.set(item.specId, item);
        }
      }
      const declarations = new TypeScriptDeclarations(current, this.options, this.context, placements), files = declarations.render();
      if (declarations.problems.length) return refused(declarations.problems);
      next = { format: 1, renderFormat: 1, outputId: this.id, options: renderingOptions(this.options), deleted: [], files: files.map(file => ({ id: file.id, path: file.path,
        generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: structuredClone(file.artifacts) as ArtifactAssociation[] })) };
      const retained = new Set(next.files.flatMap(file => file.artifacts.map(item => item.specId)));
      next.deleted = [...new Set([...(previous?.deleted ?? []), ...previous?.files.flatMap(file => file.artifacts.map(item => item.specId)) ?? []])].filter(id => !retained.has(id)).sort();
      if (previous && ['create', 'insert'].includes(request.operation) && previous.files.some(file => {
        const after = next.files.find(candidate => candidate.id === file.id); return !after || after.hash !== file.hash;
      })) return refused([outputProblem(request.operation === 'insert' ? 'not-addition-only' : 'use-update', statePath, 'Existing native contracts changed; use update.')]);
    }
    const preservation = new TypeScriptPreservation(snapshot, this.options, 'diff' in request ? request.diff : undefined);
    preservation.reconcile(previous?.files ?? [], next.files.map(file => ({ id: file.id, path: file.path, text: file.generated, artifacts: file.artifacts })),
      request.operation === 'delete' ? [] : request.current.baseline.artifacts, request.operation === 'create' && this.options.adoptExisting);
    if (preservation.problems.length) return refused(preservation.problems);
    next.files = preservation.files;
    const existingPaths = new Set(snapshot.files.map(file => file.path));
    const creates = (change: FileChange): number => Number(change.kind === 'write' && !existingPaths.has(change.path));
    // A newly referenced file must exist before the native capture rechecks its importer.
    const changes: FileChange[] = [...preservation.changes].sort((left, right) => creates(right) - creates(left));
    for (const path of [...next.files.map(file => file.path), ...changes.flatMap(change => change.kind === 'move' ? [change.from, change.to] : [change.path]), statePath]) {
      if (!literal(path) || path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(conflict(path, 'The captured scope excludes the output destination.'));
      const existing = snapshot.files.find(file => key(file.path) === key(path));
      if (existing && path !== statePath && next.files.some(file => file.path === existing.path) && !previous?.files.some(file => file.path === existing.path) && !next.files.some(file => file.path === existing.path && file.adopted?.length)) problems.push(outputProblem(this.options.adoptExisting ? 'unowned-project-artifact' : 'output-conflict', existing.path, 'Existing native file is not owned by this output.'));
      if (snapshot.files.some(file => key(path).startsWith(key(file.path) + '/') || key(file.path).startsWith(key(path) + '/'))) problems.push(conflict(path, 'An existing file occupies a destination parent or descendant.'));
    }
    if (problems.length) return refused(problems);
    const bytes = Buffer.from(canonical(next, 2) + '\n');
    if (!snapshot.files.some(file => file.path === statePath && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path: statePath, bytes });
    const obligations: Diagnostic[] = request.operation === 'delete' ? [] : preservation.unfinished().map(id => {
      const item = request.current.specification.inspection.read(request.current.node(id));
      return { code: 'implementation-required', message: 'Implement ' + ('name' in item ? item.name : item.kind) + '.', at: item.origin, related: [] };
    });
    return success({ outputId: this.id, basedOn: snapshot, changes, artifacts: next.files.flatMap(file => file.artifacts), obligations });
  }
}
