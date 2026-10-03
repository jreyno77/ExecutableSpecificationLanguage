import { z } from 'zod';
import { visit } from 'jsonc-parser';
import type { Check, Diagnostic } from './checking.js';
import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation } from './specification-identity.js';
import type { FileChange } from './project-writer.js';
import { canonical, identifier, locatorSchema, success } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { validDiff } from './output-contract.js';
import { outputProblem } from './output-documents.js';
import { TypeScriptProject } from './typescript-project.js';
import { TypeScriptDeclarations, typescriptOptions, type TypeScriptOptions } from './typescript-declarations.js';

const association = z.strictObject({ specId: identifier, locator: locatorSchema });
const stateSchema = z.strictObject({ format: z.literal(1), renderFormat: z.literal(1), outputId: z.literal('typescript'), options: z.string(),
  files: z.array(z.strictObject({ id: identifier, path: z.string(), generated: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), artifacts: z.array(association).min(1) })), deleted: z.array(identifier) });
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

/** Owns whole generated files; handwritten edits require a preservation-aware editor. */
class TypeScriptOutput implements OutputAdapter {
  readonly id = 'typescript';
  constructor(private readonly options: TypeScriptOptions, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot): { value?: State; problems: Diagnostic[] } {
    const file = snapshot.files.find(file => file.path === statePath);
    if (!file) return { problems: [] };
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes), objects: Set<string>[] = [];
      visit(text, { onObjectBegin: () => { objects.push(new Set()); }, onObjectEnd: () => { objects.pop(); }, onObjectProperty: name => {
        if (objects.at(-1)!.has(name)) throw new Error('Duplicate ownership property'); objects.at(-1)!.add(name);
      } });
      const data = JSON.parse(text);
      if (data?.renderFormat !== 1) return { problems: [outputProblem('output-options-changed', statePath, 'Recorded native render format requires an explicit migration.')] };
      const state = stateSchema.parse(data), settings = typescriptOptions.parse(JSON.parse(state.options)), paths = state.files.map(file => key(file.path)), roots = state.files.map(file => file.id), ids = state.files.flatMap(file => file.artifacts.map(item => item.specId));
      if (new Set(paths).size !== paths.length || new Set(roots).size !== roots.length || new Set(state.deleted).size !== state.deleted.length
        || state.deleted.some(id => ids.includes(id)) || state.files.some(file => !literal(file.path) || !file.path.startsWith(settings.directory + '/') || !file.path.endsWith('.ts')
          || Buffer.from(file.generated).toString('utf8') !== file.generated || hash(Buffer.from(file.generated)) !== file.hash
          || !file.artifacts.some(item => item.specId === file.id) || file.artifacts.some(item => item.locator.outputId !== this.id
            || item.locator.format !== 'typescript-symbol-1' || (item.locator.value as { file: string }).file !== file.path))) throw new Error('Invalid generation baseline');
      this.project(state);
      return { value: state, problems: state.options === canonical(this.options) ? [] : [outputProblem('output-options-changed', statePath, 'Native output options require an explicit migration.')] };
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Recorded generated text, byte hash or native associations are invalid.')] }; }
  }
  private project(state?: State): TypeScriptProject {
    return new TypeScriptProject({ outputId: this.id, ...this.options.configFile ? { configFile: this.options.configFile } : {} }, state?.files.flatMap(file => file.artifacts) ?? []);
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const state = this.state(snapshot), result = this.project(state.value).read(id, snapshot), problems = [...result.problems, ...state.problems];
    return { ...result, problems, coverage: { ...result.coverage, complete: !problems.length && result.coverage.complete,
      limitations: [...result.coverage.limitations, ...state.problems.map(problem => problem.message)] } };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const state = this.state(snapshot), result = this.project(state.value).search(id, snapshot), problems = [...result.problems, ...state.problems];
    const cover = (direction: 'incoming' | 'outgoing') => ({ ...result[direction], coverage: { ...result[direction].coverage,
      complete: !problems.length && result[direction].coverage.complete, limitations: [...result[direction].coverage.limitations, ...state.problems.map(problem => problem.message)] } });
    return { ...result, incoming: cover('incoming'), outgoing: cover('outgoing'), problems };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return refused([...snapshot.problems, outputProblem('incomplete-project', '', 'A complete captured project is required.')]);
    if (new Set(snapshot.files.map(file => key(file.path))).size !== snapshot.files.length || snapshot.files.some(file => !literal(file.path) || !(file.bytes instanceof Uint8Array) || hash(file.bytes) !== file.version)) return refused([outputProblem('invalid-project-snapshot', '', 'Captured paths and byte versions must be valid and unique.')]);
    const stored = this.state(snapshot); if (stored.problems.length) return refused(stored.problems);
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
      const declarations = new TypeScriptDeclarations(current, this.options, this.context), files = declarations.render();
      if (declarations.problems.length) return refused(declarations.problems);
      next = { format: 1, renderFormat: 1, outputId: this.id, options: canonical(this.options), deleted: [], files: files.map(file => ({ id: file.id, path: file.path,
        generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: structuredClone(file.artifacts) as ArtifactAssociation[] })) };
      const retained = new Set(next.files.flatMap(file => file.artifacts.map(item => item.specId)));
      next.deleted = [...new Set([...(previous?.deleted ?? []), ...previous?.files.flatMap(file => file.artifacts.map(item => item.specId)) ?? []])].filter(id => !retained.has(id)).sort();
      if (previous && ['create', 'insert'].includes(request.operation) && previous.files.some(file => {
        const after = next.files.find(candidate => candidate.id === file.id); return !after || canonical(after) !== canonical(file);
      })) return refused([outputProblem(request.operation === 'insert' ? 'not-addition-only' : 'use-update', statePath, 'Existing native contracts changed; use update.')]);
    }
    const desired = new Map<string, Uint8Array>(next.files.map(file => [file.path, Buffer.from(file.generated)]));
    for (const file of previous?.files ?? []) {
      const after = next.files.find(next => next.id === file.id), actual = snapshot.files.find(actual => actual.path === file.path)!;
      if (after?.path === file.path && after.hash === file.hash) desired.set(file.path, actual.bytes);
      else if (hash(actual.bytes) !== file.hash) problems.push(conflict(file.path, 'Handwritten changes prevent replacing or removing this generated contract.'));
    }
    for (const path of [...desired.keys(), statePath]) {
      if (!literal(path) || path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(conflict(path, 'The captured scope excludes the output destination.'));
      const existing = snapshot.files.find(file => key(file.path) === key(path));
      if (existing && path !== statePath && !previous?.files.some(file => file.path === existing.path)) problems.push(conflict(existing.path, 'Existing native file is not owned by this output.'));
      if (snapshot.files.some(file => key(path).startsWith(key(file.path) + '/') || key(file.path).startsWith(key(path) + '/'))) problems.push(conflict(path, 'An existing file occupies a destination parent or descendant.'));
    }
    const changes: FileChange[] = [];
    for (const file of previous?.files ?? []) if (!desired.has(file.path)) changes.push({ kind: 'remove', path: file.path });
    for (const [path, bytes] of desired) if (!snapshot.files.some(file => file.path === path && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path, bytes });
    const changed = new Set(changes.map(change => 'path' in change ? change.path : change.from)), owned = new Set(previous?.files.map(file => file.path));
    const native = this.project(previous);
    for (const file of previous?.files ?? []) for (const subject of new Set(file.artifacts.map(item => item.specId))) {
      const before = file.artifacts.filter(item => item.specId === subject), after = next.files.flatMap(file => file.artifacts.filter(item => item.specId === subject));
      if (canonical(before) === canonical(after)) continue;
      const search = native.search(subject, snapshot);
      if (!search.incoming.coverage.complete) problems.push(outputProblem('incomplete-output-search', file.path, 'Current native incoming uses are incomplete: ' + search.incoming.coverage.limitations.join('; ')));
      for (const use of search.incoming.uses) {
        const path = (use.at.value as { file: string }).file;
        if (!owned.has(path) || !changed.has(path)) problems.push(conflict(path, 'An unmodified current native caller would be broken by this change.'));
      }
    }
    if (problems.length) return refused(problems);
    const bytes = Buffer.from(canonical(next, 2) + '\n');
    if (!snapshot.files.some(file => file.path === statePath && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path: statePath, bytes });
    return success({ outputId: this.id, basedOn: snapshot, changes, artifacts: next.files.flatMap(file => file.artifacts) });
  }
}
