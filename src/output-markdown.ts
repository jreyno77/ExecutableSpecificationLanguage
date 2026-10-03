import { z } from 'zod';
import type { Check, Diagnostic } from './checking.js';
import type { OutputAdapter, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { ProjectFile, ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import { canonical, identifier, success } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { validDiff } from './output-contract.js';
import { artifact, ListDocuments, outputProblem } from './output-documents.js';
import { MarkdownDocumentation, emptyNotes, sectionEnd, sectionStart } from './markdown-document.js';
import { UnsupportedMarkdown } from './markdown-language.js';

const subject = z.strictObject({ id: identifier, structure: z.string() });
const stateSchema = z.strictObject({ format: z.literal(1), renderFormat: z.literal(1), outputId: z.literal('markdown'), directory: z.string(), context: z.string(), notes: z.literal(emptyNotes),
  documents: z.array(z.strictObject({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), subjects: z.array(subject).min(1) })), deleted: z.array(identifier) });
type State = z.infer<typeof stateSchema>;
type Region = { prefix: Uint8Array; bytes: Uint8Array; suffix: Uint8Array; start: number; end: number };
const refused = (problems: readonly Diagnostic[]): Check<OutputPlan> => ({ problems, deferred: [] });
const key = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const conflict = (path: string, message: string) => outputProblem('output-conflict', path, message);
const statePath = '.expec/outputs/' + Buffer.from('markdown').toString('hex') + '.json';

export const markdownOutput: OutputRegistration = {
  id: 'markdown',
  validate: options => [
    ...Object.keys(options).filter(key => key !== 'directory').map(key => ({ path: [key], message: 'Unknown output option.' })),
    ...(typeof options.directory === 'string' && literal(options.directory) && !options.directory.split('/').some(part => part.toLowerCase() === '.expec')
      ? [] : [{ path: ['directory'], message: 'Provide a literal relative directory outside .expec.' }]),
  ],
  open: options => new MarkdownOutput(options.directory as string),
};

/** Owns only generated regions; current project bytes remain the source of handwritten content. */
class MarkdownOutput implements OutputAdapter {
  readonly id = 'markdown';
  constructor(private readonly directory: string) {}
  private state(snapshot: ProjectSnapshot): { value?: State; problems: Diagnostic[] } {
    const file = snapshot.files.find(file => file.path === statePath);
    if (!file) return { problems: [] };
    try {
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes)), parsed = stateSchema.safeParse(data);
      if (data?.renderFormat !== 1) return { problems: [outputProblem('output-options-changed', statePath, 'The recorded render format requires an explicit migration.')] };
      if (!parsed.success) throw new Error('Invalid state');
      const value = parsed.data, paths = value.documents.map(document => document.path), ids = value.documents.flatMap(document => document.subjects.map(subject => subject.id));
      if (new Set(paths.map(key)).size !== paths.length || paths.some(path => !literal(path)) || new Set(ids).size !== ids.length
        || new Set(value.deleted).size !== value.deleted.length || value.deleted.some(id => ids.includes(id))) throw new Error('Conflicting state');
      return { value, problems: value.directory === this.directory ? [] : [outputProblem('output-options-changed', statePath, 'Output directory changes require explicit migration.')] };
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'The Markdown generation record is malformed.')] }; }
  }
  private documents(snapshot: ProjectSnapshot): ListDocuments {
    const documents = new ListDocuments('markdown', this.id, snapshot);
    for (const file of snapshot.files.filter(file => /\.(md|markdown)$/i.test(file.path))) {
      try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes); }
      catch { documents.problems.push(outputProblem('invalid-output-document', file.path, 'Markdown must be valid UTF-8; raw bytes are retained without position-based editing.')); }
    }
    return documents;
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const result = this.documents(snapshot).read(id), state = this.state(snapshot), artifacts = [...result.artifacts];
    for (const document of state.value?.documents.filter(document => document.subjects.some(subject => subject.id === id)) ?? []) {
      const file = snapshot.files.find(file => file.path === document.path);
      if (file && !artifacts.some(item => item.file.path === file.path)) artifacts.push({ at: artifact(this.id, 'markdown', file.path, id), file });
    }
    return { ...result, artifacts, problems: [...result.problems, ...state.problems] };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const result = this.documents(snapshot).search(id), state = this.state(snapshot);
    return { ...result, problems: [...result.problems, ...state.problems] };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return refused([...snapshot.problems, outputProblem('incomplete-project', '', 'A complete project snapshot is required.')]);
    if (new Set(snapshot.files.map(file => key(file.path))).size !== snapshot.files.length || snapshot.files.some(file => !literal(file.path)
      || !(file.bytes instanceof Uint8Array) || hash(file.bytes) !== file.version)) return refused([outputProblem('invalid-project-snapshot', '', 'Snapshot paths and byte versions must be valid and unique.')]);
    if (statePath.split('/').some(part => snapshot.excludeNames.includes(part)) || snapshot.files.some(file => key(statePath).startsWith(key(file.path) + '/') || key(file.path).startsWith(key(statePath) + '/'))) return refused([conflict(statePath, 'The ownership-state destination is excluded or occupied by a file.')]);
    const stored = this.state(snapshot);
    if (stored.problems.length) return refused(stored.problems);
    const previous = stored.value, documents = this.documents(snapshot), problems: Diagnostic[] = [];
    const regions = new Map<string, Region>();
    for (const file of snapshot.files.filter(file => /\.(md|markdown)$/i.test(file.path))) {
      try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes); }
      catch { problems.push(outputProblem('invalid-output-document', file.path, 'Invalid UTF-8 cannot authorize a Markdown mutation.')); }
    }
    for (const document of previous?.documents ?? []) {
      const file = snapshot.files.find(file => file.path === document.path);
      try {
        if (!file) throw new Error('The recorded file is missing.');
        const found = region(file, document.subjects[0]!.id);
        if (hash(found.bytes) !== document.hash) throw new Error('Generated bytes or boundaries were edited.');
        regions.set(document.path, found);
      } catch (error) { problems.push(conflict(document.path, error instanceof Error ? error.message : 'Invalid generated region.')); }
      if (documents.definitions.filter(definition => definition.file.path === document.path && !definition.ancestors.length).length !== 1) problems.push(conflict(document.path, 'A managed document must contain exactly one generated root.'));
      for (const subject of document.subjects) for (const definition of documents.definitions.filter(definition => definition.id === subject.id)) {
        if (definition.file.path !== document.path) problems.push(conflict(definition.file.path, 'Another current definition claims a managed subject.'));
      }
      if (documents.problems.some(problem => problem.code === 'ambiguous-definition' && JSON.stringify(problem.at).includes(document.path))) problems.push(conflict(document.path, 'Duplicate generated subject identities.'));
    }
    if (problems.length) return refused(problems);
    let next: State;
    const desired = new Map<string, Uint8Array>();
    if (request.operation === 'delete') {
      if (!previous) return refused([outputProblem('output-not-found', '', 'No owned Markdown representation exists for ' + request.id)]);
      const owner = previous.documents.find(document => document.subjects.some(subject => subject.id === request.id));
      if (!owner && !previous.deleted.includes(request.id)) return refused([outputProblem('output-not-found', '', 'No owned Markdown representation exists for ' + request.id)]);
      if (owner && owner.subjects[0]!.id !== request.id) return refused([outputProblem('nested-delete', owner.path, 'Remove a nested declaration through a specification update.')]);
      next = { ...previous, documents: previous.documents.filter(document => document !== owner),
        deleted: [...new Set([...previous.deleted, ...owner?.subjects.map(subject => subject.id) ?? []])].sort() };
      for (const document of next.documents) desired.set(document.path, snapshot.files.find(file => file.path === document.path)!.bytes);
    } else {
      const current = request.current;
      if (!current?.specification?.inspection || !current.baseline || typeof current.node !== 'function') throw new TypeError('Provide a successfully identified specification.');
      const known = new Set([...current.baseline.elements.map(record => record.id), ...current.baseline.retired]);
      if (previous && [...previous.deleted, ...previous.documents.flatMap(document => document.subjects.map(subject => subject.id))].some(id => !known.has(id))) return refused([outputProblem('unknown-output-identity', statePath, 'The current baseline does not recognize prior output identities.')]);
      if ('diff' in request && !validDiff(request.diff, current)) return refused([outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identity facts.')]);
      if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')))) return refused([outputProblem('not-addition-only', '', 'Insertion requires top-level additions; use update for existing content.')]);
      let pages;
      try { pages = new MarkdownDocumentation(current, this.directory).render(); }
      catch (error) {
        if (!(error instanceof UnsupportedMarkdown)) throw error;
        return refused([{ code: 'unsupported-output', message: error.message, at: error.item.origin, related: [] }]);
      }
      next = { format: 1, renderFormat: 1, outputId: this.id, directory: this.directory, context: current.baseline.context, notes: emptyNotes, documents: [], deleted: [] };
      for (const page of pages) {
        const root = current.baseline.elements.find(record => record.id === page.id)!, name = root.address.name;
        if (!literal(page.path) || name !== null && (!literal(name) || name.includes('/'))) problems.push(outputProblem('unsupported-artifact-name', page.path, 'The authored name cannot be a literal native filename.'));
        if (pages.some(other => other.id !== page.id && key(other.path) === key(page.path))) problems.push(conflict(page.path, 'Declarations map to the same native path.'));
        if (snapshot.excludeNames.includes('.expec') || page.path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(conflict(page.path, 'The snapshot excludes an output destination.'));
        if (snapshot.files.some(file => key(page.path).startsWith(key(file.path) + '/') || key(file.path).startsWith(key(page.path) + '/'))) problems.push(conflict(page.path, 'A file occupies a destination parent or descendant.'));
        const before = previous?.documents.find(document => document.subjects[0]!.id === page.id), existing = snapshot.files.find(file => key(file.path) === key(page.path));
        if (existing && before?.path !== existing.path) problems.push(conflict(existing.path, 'The destination is not this document’s owned file.'));
        for (const id of page.subjects) for (const definition of documents.definitions.filter(definition => definition.id === id)) {
          if (!previous?.documents.some(document => document.path === definition.file.path && document.subjects.some(subject => subject.id === id))) problems.push(conflict(definition.file.path, 'An unowned current definition already claims this subject.'));
        }
        const old = before && regions.get(before.path);
        desired.set(page.path, old ? Buffer.concat([old.prefix, page.region, old.suffix]) : Buffer.concat([page.region, Buffer.from(emptyNotes)]));
        next.documents.push({ path: page.path, hash: hash(page.region),
          subjects: page.subjects.map(id => ({ id, structure: current.baseline.elements.find(record => record.id === id)!.structure })) });
      }
      const rendered = new Set(next.documents.flatMap(document => document.subjects.map(subject => subject.id)));
      next.deleted = [...new Set([...(previous?.deleted ?? []), ...previous?.documents.flatMap(document => document.subjects.map(subject => subject.id)) ?? []])].filter(id => !rendered.has(id)).sort();
      if ((request.operation === 'create' || request.operation === 'insert') && previous && (previous.context !== next.context || previous.documents.some(document => {
        const after = next.documents.find(candidate => candidate.subjects[0]!.id === document.subjects[0]!.id);
        return !after || canonical(after) !== canonical(document);
      }))) problems.push(outputProblem(request.operation === 'insert' ? 'not-addition-only' : 'use-update', statePath, 'Existing generated documents changed; use update.'));
    }
    const changes: FileChange[] = [];
    for (const before of previous?.documents ?? []) {
      const after = next.documents.find(document => document.subjects[0]!.id === before.subjects[0]!.id);
      if (after?.path === before.path) continue;
      if (!after) {
        const old = regions.get(before.path)!;
        if (old.prefix.length || !Buffer.from(old.suffix).equals(Buffer.from(previous!.notes))) problems.push(outputProblem('handwritten-document-content', before.path, 'Relocate or clear handwritten notes before removing this page.'));
        changes.push({ kind: 'remove', path: before.path });
      } else changes.push({ kind: 'move', from: before.path, to: after.path, bytes: desired.get(after.path)! });
    }
    const moved = new Set(changes.flatMap(change => change.kind === 'move' ? [change.to] : []));
    for (const [path, bytes] of desired) if (!moved.has(path) && !snapshot.files.some(file => file.path === path && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path, bytes });
    const changed = new Set(changes.flatMap(change => change.kind === 'move' ? [change.from, change.to] : [change.path]));
    for (const before of previous?.documents ?? []) for (const subject of before.subjects) {
      const after = next.documents.find(document => document.subjects.some(candidate => candidate.id === subject.id));
      if (after?.path === before.path) continue;
      const search = documents.search(subject.id);
      if (!search.incoming.coverage.complete) problems.push(outputProblem('incomplete-output-search', before.path, 'Incoming uses are incomplete within the Markdown profile.'));
      for (const use of search.incoming.uses) {
        const { path, offset } = use.at.value as { path: string; offset: number }, owned = regions.get(path);
        if (!owned || !changed.has(path) || offset < owned.start || offset >= owned.end) problems.push(conflict(path, 'A remaining handwritten or unowned incoming link prevents this change.'));
      }
    }
    if (problems.length) return refused(problems);
    const state = Buffer.from(canonical(next, 2) + '\n');
    if (!snapshot.files.some(file => file.path === statePath && hash(file.bytes) === hash(state))) changes.push({ kind: 'write', path: statePath, bytes: state });
    return success({ outputId: this.id, basedOn: snapshot, changes, artifacts: next.documents.flatMap(document => document.subjects.map(subject =>
      ({ specId: subject.id, locator: artifact(this.id, 'markdown', document.path, subject.id) }))) });
  }
}
function region(file: ProjectFile, id: string): Region {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes), start = text.indexOf(sectionStart(id)), marker = sectionEnd(id) + '\n\n';
  const end = text.indexOf(marker, start) + marker.length;
  if (start < 0 || end < marker.length || text.indexOf(sectionStart(id), start + 1) >= 0 || text.indexOf(sectionEnd(id), end) >= 0) throw new Error('Missing or duplicate generated boundaries.');
  const beginBytes = Buffer.byteLength(text.slice(0, start)), endBytes = Buffer.byteLength(text.slice(0, end));
  return { prefix: file.bytes.slice(0, beginBytes), bytes: file.bytes.slice(beginBytes, endBytes), suffix: file.bytes.slice(endBytes), start, end };
}
