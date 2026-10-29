import { includedPlan, validDiff } from './output-contract.js';
import { protectsExcludedPath, validPathPolicy } from '../connection/project-exclusions.js';
import { z } from 'zod';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { ProjectFile, ProjectSnapshot } from '../connection/project-connection.js';
import type { FileChange } from '../connection/project-writer.js';
import { canonical, identifier, success } from '../../model/identity-baseline.js';
import { hash, literal } from '../connection/project-files.js';
import { artifact, ListDocuments, outputProblem } from './output-documents.js';
import { anchor } from './output-projection.js';
import { MarkdownDocumentation, MarkdownLayoutError, renderMarkdownHome, emptyNotes, sectionEnd, sectionStart, type MarkdownPage } from './markdown-document.js';
import { pageStart, pageEnd } from './markdown-page.js';
import { UnsupportedLanguage } from '../../language/language-text.js';

const subject = z.strictObject({ id: identifier, structure: z.string() });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const legacySchema = z.strictObject({ format: z.literal(1), renderFormat: z.literal(1), outputId: z.literal('markdown'), directory: z.string(), context: z.string(), notes: z.literal(emptyNotes),
  documents: z.array(z.strictObject({ path: z.string(), hash: digest, subjects: z.array(subject).min(1) })), deleted: z.array(identifier) });
const pageSchema = z.strictObject({ kind: z.enum(['home', 'source']), key: z.string().min(1), path: z.string(), hash: digest, subjects: z.array(subject) });
const stateSchema = z.strictObject({ format: z.literal(2), renderFormat: z.literal(2), outputId: z.literal('markdown'), directory: z.string(), sourceRoot: z.string(), context: z.string(), notes: z.literal(emptyNotes),
  pages: z.array(pageSchema), deleted: z.array(identifier) });
type State = z.infer<typeof stateSchema>;
type Legacy = z.infer<typeof legacySchema>;
type OwnedPage = z.infer<typeof pageSchema> & { legacy?: boolean };
type Region = { prefix: Uint8Array; bytes: Uint8Array; suffix: Uint8Array; start: number; end: number };
const refused = (problems: readonly Diagnostic[]): Check<OutputPlan> => ({ problems, deferred: [] });
const key = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const pageKey = (page: { kind: string; key: string }) => canonical([page.kind, page.key]);
const conflict = (path: string, text: string) => outputProblem('output-conflict', path, text);
const statePath = '.expec/outputs/' + Buffer.from('markdown').toString('hex') + '.json';
const ownedPages = (state?: State | Legacy): OwnedPage[] => !state ? [] : state.format === 2 ? state.pages
  : state.documents.map(page => ({ ...page, kind: 'source', key: page.subjects[0]!.id, legacy: true }));
const hasNotes = (region: Region) => region.prefix.length > 0 || !Buffer.from(region.suffix).equals(Buffer.from(emptyNotes));
const layoutProblem = (error: MarkdownLayoutError) => outputProblem('invalid-source-layout', error.sourceId, error.message);

export const markdownOutput: OutputRegistration = {
  id: 'markdown',
  validate: options => [
    ...Object.keys(options).filter(name => name !== 'directory' && name !== 'sourceRoot').map(name => ({ path: [name], message: 'Unknown output option.' })),
    ...(typeof options.directory === 'string' && literal(options.directory) && !options.directory.split('/').some(part => part.toLowerCase() === '.expec')
      ? [] : [{ path: ['directory'], message: 'Provide a literal relative directory outside .expec.' }]),
    ...(options.sourceRoot === undefined || typeof options.sourceRoot === 'string' && !!options.sourceRoot.trim() && !options.sourceRoot.startsWith('/') && !/[\\:\0]/.test(options.sourceRoot)
      ? [] : [{ path: ['sourceRoot'], message: 'Provide a literal manifest-relative source root.' }]),
  ],
  open: (options, context) => new MarkdownOutput(options.directory as string, options.sourceRoot as string ?? '.', context),
  preview: async (current, options, context) => {
    let pages: MarkdownPage[];
    try { pages = new MarkdownDocumentation(current, options.directory as string, options.sourceRoot as string ?? '.', context).render(); }
    catch (error) {
      if (error instanceof MarkdownLayoutError) return { problems: [layoutProblem(error)], deferred: [] };
      if (!(error instanceof UnsupportedLanguage)) throw error;
      return { problems: [{ code: 'unsupported-output', message: error.message, at: error.item.origin, related: [] }], deferred: [] };
    }
    const problems = pageConflicts(pages);
    return problems.length ? { problems, deferred: [] } : success(pages.map(page => ({ path: page.path, mediaType: 'text/markdown', bytes: page.region })));
  },
};

/** Owns native page regions; real semantic sections retain their existing identities. */
class MarkdownOutput implements OutputAdapter {
  readonly id = 'markdown';
  constructor(private readonly directory: string, private readonly sourceRoot: string, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot): { value?: State | Legacy; problems: Diagnostic[] } {
    const file = snapshot.files.find(file => file.path === statePath);
    if (!file) return { problems: [] };
    try {
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes));
      if (data?.renderFormat !== 1 && data?.renderFormat !== 2) return { problems: [outputProblem('output-options-changed', statePath, 'The recorded render format requires an explicit migration.')] };
      const value = data.format === 1 ? legacySchema.parse(data) : stateSchema.parse(data), pages = ownedPages(value);
      const ids = pages.flatMap(page => page.subjects.map(subject => subject.id));
      if (new Set(pages.map(page => key(page.path))).size !== pages.length || pages.some(page => !literal(page.path))
        || new Set(ids).size !== ids.length || new Set(value.deleted).size !== value.deleted.length || value.deleted.some(id => ids.includes(id))) throw Error('Conflicting state');
      if (value.format === 2 && (pages.filter(page => page.kind === 'home').length !== 1 || new Set(pages.map(pageKey)).size !== pages.length
        || pages.some(page => page.kind === 'home' ? page.key !== 'Home' || page.path !== value.directory + '/Home.md' || page.subjects.length !== 0 : !page.path.startsWith(value.directory + '/pages/')))) throw Error('Invalid source-page state');
      return { value, problems: value.directory !== this.directory || value.format === 2 && value.sourceRoot !== this.sourceRoot
        ? [outputProblem('output-options-changed', statePath, 'Output directory or source root changes require explicit migration.')] : [] };
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
    for (const page of ownedPages(state.value).filter(page => page.subjects.some(subject => subject.id === id))) {
      const file = snapshot.files.find(file => file.path === page.path);
      if (file && !artifacts.some(item => item.file.path === file.path)) artifacts.push({ at: artifact(this.id, 'markdown', file.path, id), file });
    }
    return { ...result, artifacts, problems: [...result.problems, ...state.problems] };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const result = this.documents(snapshot).search(id), state = this.state(snapshot);
    return { ...result, problems: [...result.problems, ...state.problems] };
  }
  private regions(snapshot: ProjectSnapshot, pages: readonly OwnedPage[], documents: ListDocuments, problems: Diagnostic[]): Map<string, Region> {
    const regions = new Map<string, Region>();
    for (const page of pages) {
      try {
        const file = snapshot.files.find(file => file.path === page.path);
        if (!file) throw Error('The recorded file is missing.');
        const region = pageRegion(file, page);
        if (hash(region.bytes) !== page.hash) throw Error('Generated bytes or boundaries were edited.');
        if (page.legacy) {
          if (documents.definitions.filter(definition => definition.file.path === page.path && !definition.ancestors.length).length !== 1) throw Error('A legacy managed document must contain exactly one generated root.');
        } else if (documents.pages.filter(found => found.file.path === page.path && found.outputId === this.id && pageKey(found) === pageKey(page)).length !== 1)
          throw Error('The native page envelope does not match its ownership record.');
        const actual = documents.definitions.filter(definition => definition.file.path === page.path).map(definition => definition.id).sort();
        if (canonical(actual) !== canonical(page.subjects.map(subject => subject.id).sort())) throw Error('The page subject inventory disagrees with actual sections.');
        if (documents.problems.some(problem => problem.at.kind === 'dependency' && problem.at.path[1] === page.path)) throw Error('The managed Markdown page has incomplete native structure.');
        regions.set(page.path, region);
      } catch (error) { problems.push(conflict(page.path, error instanceof Error ? error.message : 'Invalid generated region.')); }
      for (const subject of page.subjects) for (const definition of documents.definitions.filter(definition => definition.id === subject.id))
        if (definition.file.path !== page.path) problems.push(conflict(definition.file.path, 'Another current definition claims a managed subject.'));
    }
    return regions;
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return refused([...snapshot.problems, outputProblem('incomplete-project', '', 'A complete project snapshot is required.')]);
    if (!validPathPolicy(snapshot) || new Set(snapshot.files.map(file => key(file.path))).size !== snapshot.files.length || snapshot.files.some(file => !literal(file.path)
      || !(file.bytes instanceof Uint8Array) || hash(file.bytes) !== file.version)) return refused([outputProblem('invalid-project-snapshot', '', 'Snapshot paths and byte versions must be valid and unique.')]);
    if (protectsExcludedPath(snapshot, statePath) || snapshot.excludeNames.includes('.expec') || snapshot.files.some(file => key(statePath).startsWith(key(file.path) + '/') || key(file.path).startsWith(key(statePath) + '/')))
      return refused([conflict(statePath, 'The ownership-state destination is excluded or occupied by a file.')]);
    const stored = this.state(snapshot);
    if (stored.problems.length) return refused(stored.problems);
    const previous = stored.value, before = ownedPages(previous), documents = this.documents(snapshot), problems: Diagnostic[] = [];
    problems.push(...documents.problems.filter(problem => problem.code === 'invalid-output-document' && problem.message.startsWith('Markdown must be valid UTF-8')));
    const regions = this.regions(snapshot, before, documents, problems);
    if (problems.length) return refused(problems);
    if (request.operation === 'delete' && previous?.format === 1)
      return refused([outputProblem('output-options-changed', statePath, 'Update the Markdown output with the current specification before deleting a legacy declaration page.')]);
    let next: State, pages: MarkdownPage[];
    if (request.operation === 'delete') {
      if (!previous || previous.format !== 2) return refused([outputProblem('output-not-found', '', 'No owned Markdown representation exists for ' + request.id)]);
      const owner = before.find(page => page.subjects.some(subject => subject.id === request.id));
      if (!owner && !previous.deleted.includes(request.id)) return refused([outputProblem('output-not-found', '', 'No owned Markdown representation exists for ' + request.id)]);
      const roots = owner && documents.definitions.filter(definition => definition.file.path === owner.path && !definition.ancestors.length);
      if (owner && (roots?.length !== 1 || roots[0]!.id !== request.id)) return refused([outputProblem('nested-delete', owner.path, 'Remove a subject within a shared source page through a specification update.')]);
      const retained = before.filter(page => page !== owner && page.kind !== 'home');
      pages = [renderMarkdownHome(this.directory, retained), ...retained.map(page => ({ kind: page.kind, key: page.key, path: page.path, region: regions.get(page.path)!.bytes, subjects: page.subjects.map(subject => subject.id) }))];
      next = { ...previous, pages: [], deleted: [...new Set([...previous.deleted, ...owner?.subjects.map(subject => subject.id) ?? []])].sort() };
    } else {
      const current = request.current;
      if (!current?.specification?.inspection || !current.baseline || typeof current.node !== 'function') throw new TypeError('Provide a successfully identified specification.');
      const known = new Set([...current.baseline.elements.map(record => record.id), ...current.baseline.retired]);
      if (previous && [...previous.deleted, ...before.flatMap(page => page.subjects.map(subject => subject.id))].some(id => !known.has(id))) return refused([outputProblem('unknown-output-identity', statePath, 'The current baseline does not recognize prior output identities.')]);
      if ('diff' in request && !validDiff(request.diff, current)) return refused([outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identity facts.')]);
      if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')))) return refused([outputProblem('not-addition-only', '', 'Insertion requires additions with unchanged context; use update for existing content.')]);
      try { pages = new MarkdownDocumentation(current, this.directory, this.sourceRoot, this.context).render(); }
      catch (error) {
        if (error instanceof MarkdownLayoutError) return refused([layoutProblem(error)]);
        if (!(error instanceof UnsupportedLanguage)) throw error;
        return refused([{ code: 'unsupported-output', message: error.message, at: error.item.origin, related: [] }]);
      }
      const represented = new Set(pages.flatMap(page => page.subjects));
      next = { format: 2, renderFormat: 2, outputId: this.id, directory: this.directory, sourceRoot: this.sourceRoot, context: current.baseline.context, notes: emptyNotes, pages: [],
        deleted: [...new Set([...(previous?.deleted ?? []), ...before.flatMap(page => page.subjects.map(subject => subject.id))])].filter(id => !represented.has(id)).sort() };
      if (previous && request.operation !== 'update') {
        if (previous.format !== 2) return refused([outputProblem(request.operation === 'insert' ? 'not-addition-only' : 'use-update', statePath, 'Use update to migrate existing declaration pages.')]);
        for (const old of before) {
          const after = pages.find(page => pageKey(page) === pageKey(old));
          if (!after || after.path !== old.path || old.subjects.some(subject => !after.subjects.includes(subject.id)
            || !Buffer.from(sectionBytes(regions.get(old.path)!.bytes, subject.id)).equals(sectionBytes(after.region, subject.id))))
            problems.push(outputProblem(request.operation === 'insert' ? 'not-addition-only' : 'use-update', old.path, 'Existing semantic sections changed; use update.'));
        }
      }
    }
    problems.push(...pageConflicts(pages));
    const targets = new Map(before.map(old => {
      const exact = !old.legacy && pages.find(page => pageKey(page) === pageKey(old));
      return [old, exact ? [exact] : pages.filter(page => page.kind === 'source' && old.subjects.some(subject => page.subjects.includes(subject.id)))];
    }));
    const contributors = (page: MarkdownPage) => before.filter(old => targets.get(old)!.includes(page));
    const desired = new Map<string, Uint8Array>();
    for (const old of before) if ((targets.get(old)!.length !== 1 || contributors(targets.get(old)![0]!).length !== 1) && hasNotes(regions.get(old.path)!))
      problems.push(outputProblem('handwritten-document-content', old.path, 'Relocate handwritten notes before consolidating, splitting or removing this source page.'));
    for (const page of pages) {
      if (protectsExcludedPath(snapshot, page.path) || snapshot.excludeNames.includes('.expec') || page.path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(conflict(page.path, 'The snapshot excludes an output destination.'));
      if (snapshot.files.some(file => key(page.path).startsWith(key(file.path) + '/') || key(file.path).startsWith(key(page.path) + '/'))) problems.push(conflict(page.path, 'A file occupies a destination parent or descendant.'));
      const existing = snapshot.files.find(file => key(file.path) === key(page.path));
      if (existing && !before.some(old => old.path === existing.path)) problems.push(conflict(existing.path, 'The destination is not this output’s owned file.'));
      for (const id of page.subjects) for (const definition of documents.definitions.filter(definition => definition.id === id))
        if (!before.some(old => old.path === definition.file.path && old.subjects.some(subject => subject.id === id))) problems.push(conflict(definition.file.path, 'An unowned current definition already claims this subject.'));
      for (const found of documents.pages.filter(found => found.outputId === this.id && pageKey(found) === pageKey(page)))
        if (!before.some(old => old.path === found.file.path)) problems.push(conflict(found.file.path, 'An unowned native page already claims this source.'));
      const contributorsHere = contributors(page), old = contributorsHere.length === 1 && targets.get(contributorsHere[0]!)!.length === 1 ? regions.get(contributorsHere[0]!.path) : undefined;
      desired.set(page.path, old ? Buffer.concat([old.prefix, page.region, old.suffix]) : Buffer.concat([page.region, Buffer.from(emptyNotes)]));
      next.pages.push({ kind: page.kind, key: page.key, path: page.path, hash: hash(page.region), subjects: page.subjects.map(id => ({ id,
        structure: request.operation === 'delete' ? before.flatMap(page => page.subjects).find(subject => subject.id === id)!.structure
          : request.current.baseline.elements.find(record => record.id === id)!.structure })) });
    }
    if (problems.length) return refused(problems);
    const changes: FileChange[] = [], movedTo = new Set<string>(), movedFrom = new Set<string>();
    for (const old of before) {
      const selected = targets.get(old)!;
      if (selected.length === 1 && contributors(selected[0]!).length === 1 && selected[0]!.path !== old.path && !desired.has(old.path)
        && !snapshot.files.some(file => key(file.path) === key(selected[0]!.path))) {
        changes.push({ kind: 'move', from: old.path, to: selected[0]!.path, bytes: desired.get(selected[0]!.path)! }); movedTo.add(selected[0]!.path); movedFrom.add(old.path);
      }
    }
    for (const [path, bytes] of desired) if (!movedTo.has(path) && !snapshot.files.some(file => file.path === path && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path, bytes });
    for (const old of before) if (!desired.has(old.path) && !movedFrom.has(old.path)) changes.push({ kind: 'remove', path: old.path });
    const changed = new Set(changes.flatMap(change => change.kind === 'move' ? [change.from, change.to] : [change.path]));
    const protectedUse = (path: string, offset: number) => { const region = regions.get(path); return !region || !changed.has(path) || offset < region.start || offset >= region.end; };
    for (const old of before) {
      const samePage = pages.find(page => pageKey(page) === pageKey(old));
      const relocated = old.legacy || !samePage || samePage.path !== old.path;
      for (const subject of old.subjects) {
        const after = pages.find(page => page.subjects.includes(subject.id));
        if (after?.path === old.path) continue;
        const search = documents.search(subject.id);
        if (!search.incoming.coverage.complete) problems.push(outputProblem('incomplete-output-search', old.path, 'Incoming Markdown uses are incomplete.'));
        for (const use of search.incoming.uses) { const at = use.at.value as { path: string; offset: number }; if (protectedUse(at.path, at.offset)) problems.push(conflict(at.path, 'A remaining handwritten or unowned incoming link prevents this change.')); }
        for (const edge of documents.edges.filter(edge => edge.target?.kind === 'project' && edge.target.id === old.path + '#' + anchor(subject.id)))
          if (protectedUse(edge.path, (edge.at.value as { offset: number }).offset)) problems.push(conflict(edge.path, 'A remaining handwritten or unowned anchor link prevents this change.'));
      }
      if (relocated) for (const edge of documents.edges.filter(edge => edge.target?.kind === 'project' && (edge.target.id === old.path || edge.target.id.startsWith(old.path + '#'))))
        if (protectedUse(edge.path, (edge.at.value as { offset: number }).offset)) problems.push(conflict(edge.path, 'A remaining handwritten or unowned whole-page link prevents this change.'));
    }
    if (problems.length) return refused(problems);
    const state = Buffer.from(canonical(next, 2) + '\n');
    if (!snapshot.files.some(file => file.path === statePath && hash(file.bytes) === hash(state))) changes.push({ kind: 'write', path: statePath, bytes: state });
    return includedPlan({ outputId: this.id, basedOn: snapshot, changes, artifacts: next.pages.flatMap(page => page.subjects.map(subject =>
      ({ specId: subject.id, locator: artifact(this.id, 'markdown', page.path, subject.id) }))) });
  }
}

function pageConflicts(pages: readonly MarkdownPage[]): Diagnostic[] {
  return pages.flatMap((page, index) => !literal(page.path) ? [outputProblem('unsupported-artifact-name', page.path, 'Source page must have a literal native filename.')]
    : pages.slice(0, index).some(other => key(other.path) === key(page.path)) ? [conflict(page.path, 'Source files map to the same native page.')] : []);
}
function pageRegion(file: ProjectFile, page: OwnedPage): Region {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes);
  const startMarker = page.legacy ? sectionStart(page.subjects[0]!.id) : pageStart({ outputId: 'markdown', kind: page.kind, key: page.key });
  const endMarker = (page.legacy ? sectionEnd(page.subjects[0]!.id) : pageEnd(page.key)) + '\n\n';
  const start = text.indexOf(startMarker), end = text.indexOf(endMarker, start) + endMarker.length;
  if (start < 0 || end < endMarker.length || text.indexOf(startMarker, start + 1) >= 0 || text.indexOf(endMarker, end) >= 0) throw Error('Missing or duplicate generated boundaries.');
  const beginBytes = Buffer.byteLength(text.slice(0, start)), endBytes = Buffer.byteLength(text.slice(0, end));
  return { prefix: file.bytes.slice(0, beginBytes), bytes: file.bytes.slice(beginBytes, endBytes), suffix: file.bytes.slice(endBytes), start, end };
}
function sectionBytes(bytes: Uint8Array, id: string): Uint8Array {
  const text = Buffer.from(bytes).toString('utf8'), startMarker = [sectionStart(id), sectionStart(id).replace('expec-section:', 'expec-fragment:')].find(marker => text.includes(marker));
  if (!startMarker) return Buffer.alloc(0);
  const start = text.indexOf(startMarker), end = text.indexOf(sectionEnd(id), start);
  return end < 0 ? Buffer.alloc(0) : Buffer.from(text.slice(start, end + sectionEnd(id).length));
}
