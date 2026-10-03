import { validDiff } from './output-contract.js';
import type { OutputRegistration } from './output.js';
import type { Check, Diagnostic } from './checking.js';
import type { OutputAdapter, OutputPlan, OutputRequest } from './output.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import type { ArtifactAssociation } from './specification-identity.js';
import { z } from 'zod';
import { canonical, identifier, success } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { listDeclarations, flatten } from './output-projection.js';
import { artifact, ListDocuments, outputProblem, renderList, type ListFormat } from './output-documents.js';

const subject = z.strictObject({ id: identifier, structure: z.string(), name: z.string() });
const stateSchema = z.strictObject({ format: z.literal(1), renderFormat: z.literal(1), outputId: z.string(), directory: z.string(), context: z.string(),
  documents: z.array(z.strictObject({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), subjects: z.array(subject).min(1) })), deleted: z.array(identifier) });
type State = z.infer<typeof stateSchema>;
const rejected = (problems: readonly Diagnostic[]): Check<OutputPlan> => ({ problems, deferred: [] });
const pathKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;
function registration(id: string, format: ListFormat): OutputRegistration {
  return { id, validate: options => {
    const problems = Object.keys(options).filter(key => key !== 'directory').map(key => ({ path: [key], message: 'Unknown output option.' }));
    if (typeof options.directory !== 'string' || !literal(options.directory) || options.directory.split('/').some(part => part.toLowerCase() === '.expec')) problems.push({ path: ['directory'], message: 'Provide a literal relative directory outside .expec.' });
    return problems;
  }, open: options => new ListOutput(id, format, options.directory as string) };
}
export const contractListOutput = registration('contract-list', 'markdown');
export const structureListOutput = registration('structure-list', 'structure');

/** Whole-file ownership and reconciliation for the two small documentation profiles. */
class ListOutput implements OutputAdapter {
  private readonly statePath: string;
  constructor(readonly id: string, private readonly format: ListFormat, private readonly directory: string) {
    this.statePath = '.expec/outputs/' + Buffer.from(id).toString('hex') + '.json';
  }
  private state(snapshot: ProjectSnapshot): { value?: State; problems: Diagnostic[] } {
    const file = snapshot.files.find(file => file.path === this.statePath);
    if (!file) return { problems: [] };
    try {
      const data: unknown = JSON.parse(Buffer.from(file.bytes).toString('utf8')), parsed = stateSchema.safeParse(data);
      if (data && typeof data === 'object' && 'renderFormat' in data && data.renderFormat !== 1) return { problems: [outputProblem('output-options-changed', this.statePath, 'The recorded render format requires an explicit migration.')] };
      if (!parsed.success || parsed.data.outputId !== this.id) throw new Error('Invalid output state.');
      const value = parsed.data, paths = value.documents.map(document => document.path), ids = value.documents.flatMap(document => document.subjects.map(subject => subject.id));
      if (new Set(paths.map(pathKey)).size !== paths.length || new Set(ids).size !== ids.length || paths.some(path => !literal(path))
        || new Set(value.deleted).size !== value.deleted.length || value.deleted.some(id => ids.includes(id))) throw new Error('Conflicting state records.');
      return { value, problems: value.directory === this.directory ? [] : [outputProblem('output-options-changed', this.statePath, 'Output options changed; relocation requires an explicit migration.')] };
    } catch { return { problems: [outputProblem('invalid-output-state', this.statePath, 'The generation record is malformed or has an unsupported version.')] }; }
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const result = new ListDocuments(this.format, this.id, snapshot).read(id), state = this.state(snapshot);
    return { ...result, problems: [...result.problems, ...state.problems] };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const result = new ListDocuments(this.format, this.id, snapshot).search(id), state = this.state(snapshot);
    return { ...result, problems: [...result.problems, ...state.problems] };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return rejected([...snapshot.problems, outputProblem('incomplete-project', '', 'A complete project snapshot is required.')]);
    if (new Set(snapshot.files.map(file => pathKey(file.path))).size !== snapshot.files.length || snapshot.files.some(file => !literal(file.path)
      || !(file.bytes instanceof Uint8Array) || hash(file.bytes) !== file.version)) return rejected([outputProblem('invalid-project-snapshot', '', 'Snapshot paths and byte versions must be valid and unique.')]);
    const stored = this.state(snapshot);
    if (stored.problems.length) return rejected(stored.problems);
    const documents = new ListDocuments(this.format, this.id, snapshot), previous = stored.value;
    const conflict = (path: string, message: string) => outputProblem('output-conflict', path, message);
    const problems: Diagnostic[] = [];
    for (const document of previous?.documents ?? []) {
      const file = snapshot.files.find(file => file.path === document.path);
      if (!file || hash(file.bytes) !== document.hash) problems.push(conflict(document.path, 'Recorded generated bytes were removed or edited.'));
      for (const subject of document.subjects) for (const definition of documents.definitions.filter(definition => definition.id === subject.id)) {
        if (definition.file.path !== document.path) problems.push(conflict(definition.file.path, 'Another definition claims a managed subject.'));
      }
    }
    if (problems.length) return rejected(problems);
    let next: State, desired = new Map<string, Uint8Array>();
    if (request.operation === 'delete') {
      if (!previous) return rejected([outputProblem('output-not-found', '', 'No owned representation for ' + request.id)]);
      const owner = previous.documents.find(document => document.subjects.some(subject => subject.id === request.id));
      if (!owner && !previous.deleted.includes(request.id)) return rejected([outputProblem('output-not-found', '', 'No owned representation for ' + request.id)]);
      if (owner && owner.subjects[0]!.id !== request.id) return rejected([outputProblem('nested-delete', owner.path, 'Remove a nested declaration through a specification update.')]);
      next = { ...previous, documents: previous.documents.filter(document => document !== owner), deleted: [...new Set([...previous.deleted, ...owner?.subjects.map(subject => subject.id) ?? []])].sort() };
      desired = new Map(next.documents.map(document => [document.path, snapshot.files.find(file => file.path === document.path)!.bytes]));
    } else {
      const current = request.current;
      if (!current?.specification?.inspection || !current.baseline || typeof current.node !== 'function') throw new TypeError('Provide a successfully identified specification.');
      const known = new Set([...current.baseline.elements.map(record => record.id), ...current.baseline.retired]);
      if (previous && [...previous.deleted, ...previous.documents.flatMap(document => document.subjects.map(subject => subject.id))].some(id => !known.has(id))) return rejected([outputProblem('unknown-output-identity', this.statePath, 'The current identity baseline does not recognize previously rendered subjects.')]);
      if ('diff' in request && !validDiff(request.diff, current)) return rejected([outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identity facts.')]);
      if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')))) return rejected([outputProblem('not-addition-only', '', 'Insertion requires top-level additions only; use update for existing declarations.')]);
      const declarations = listDeclarations(current), locations = new Map(current.baseline.elements.map(record => [record.id, { path: '', name: record.address.name ?? record.address.kind }]));
      const paths = declarations.map(declaration => this.directory + '/' + declaration.name + (this.format === 'markdown' ? '.md' : '.structure.json'));
      for (const [index, declaration] of declarations.entries()) {
        const path = paths[index]!;
        if (!validName(declaration.name)) problems.push(outputProblem('unsupported-artifact-name', path, 'The authored declaration name cannot be a literal native file name.'));
        if (paths.some((other, otherIndex) => otherIndex !== index && pathKey(other) === pathKey(path))) problems.push(conflict(path, 'Declarations map to the same native file path.'));
        if (path.split('/').some(part => snapshot.excludeNames.includes(part)) || snapshot.excludeNames.includes('.expec')) problems.push(conflict(path, 'The configured snapshot excludes an output destination.'));
        if (snapshot.files.some(file => pathKey(path).startsWith(pathKey(file.path) + '/') || pathKey(file.path).startsWith(pathKey(path) + '/'))) problems.push(conflict(path, 'An existing file occupies a destination parent or descendant.'));
        for (const subject of flatten(declaration)) locations.set(subject.specId!, { path, name: subject.name });
      }
      if (problems.length) return rejected(problems);
      next = { format: 1, renderFormat: 1, outputId: this.id, directory: this.directory, context: current.baseline.context, deleted: [], documents: [] };
      for (const [index, declaration] of declarations.entries()) {
        const path = paths[index]!, bytes = renderList(this.format, this.id, path, declaration, locations), existing = snapshot.files.find(file => pathKey(file.path) === pathKey(path));
        const owned = previous?.documents.find(document => document.path === path);
        if (existing && !owned) problems.push(conflict(existing.path, 'An existing file is not owned by this output.'));
        for (const subject of flatten(declaration)) for (const definition of documents.definitions.filter(definition => definition.id === subject.specId)) {
          if (!previous?.documents.some(document => document.path === definition.file.path && document.subjects.some(record => record.id === subject.specId))) problems.push(conflict(definition.file.path, 'An unowned definition already claims this subject.'));
        }
        desired.set(path, bytes);
        next.documents.push({ path, hash: hash(bytes), subjects: flatten(declaration).map(subject => ({ id: subject.specId!, name: subject.name,
          structure: current.baseline.elements.find(record => record.id === subject.specId)!.structure })) });
      }
      next.deleted = [...new Set([...(previous?.deleted ?? []), ...(previous?.documents.flatMap(document => document.subjects.map(subject => subject.id)) ?? [])])]
        .filter(id => !locations.get(id)?.path).sort();
      if ((request.operation === 'create' || request.operation === 'insert') && previous && (previous.context !== next.context || previous.documents.some(document => {
        const after = next.documents.find(candidate => candidate.subjects[0]!.id === document.subjects[0]!.id);
        return !after || canonical(after) !== canonical(document);
      }))) problems.push(outputProblem(request.operation === 'insert' ? 'not-addition-only' : 'use-update', this.statePath, 'Existing generated declarations changed; use update.'));
      if (problems.length) return rejected(problems);
    }
    const changes: FileChange[] = [];
    const oldPaths = new Set(previous?.documents.map(document => document.path));
    for (const path of oldPaths) if (!desired.has(path)) changes.push({ kind: 'remove', path });
    for (const [path, bytes] of desired) if (!snapshot.files.some(file => file.path === path && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path, bytes });
    const changedPaths = new Set(changes.flatMap(change => 'path' in change ? [change.path] : []));
    for (const before of previous?.documents ?? []) for (const subject of before.subjects) {
      const after = next.documents.find(document => document.subjects.some(candidate => candidate.id === subject.id));
      if (after?.path === before.path) continue;
      const search = documents.search(subject.id);
      if (!search.incoming.coverage.complete) problems.push(outputProblem('incomplete-output-search', before.path, 'Cannot prove incoming uses complete within this output profile.'));
      for (const use of search.incoming.uses) {
        const path = (use.at.value as { path: string }).path;
        if (!oldPaths.has(path) || !changedPaths.has(path)) problems.push(conflict(path, 'A remaining incoming use prevents removing or moving this definition.'));
      }
    }
    if (problems.length) return rejected(problems);
    const bytes = Buffer.from(canonical(next, 2) + '\n');
    if (!snapshot.files.some(file => file.path === this.statePath && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path: this.statePath, bytes });
    const artifacts: ArtifactAssociation[] = next.documents.flatMap(document => document.subjects.map(subject => ({ specId: subject.id, locator: artifact(this.id, this.format, document.path, subject.id) })));
    return success({ outputId: this.id, basedOn: snapshot, changes, artifacts });
  }
}
function validName(name: string): boolean { return literal(name) && !name.includes('/'); }
