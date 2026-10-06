import type { OutputRegistration, OutputAdapter, OutputPlan, OutputRequest } from './output.js';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ArtifactAssociation } from '../../model/specification-identity.js';
import { canonical, success } from '../../model/identity-baseline.js';
import { hash, literal } from '../connection/project-files.js';
import { structure, interactions, nativeKey, type Drawing } from './uml-projection.js';
import type { FileChange } from '../connection/project-writer.js';
import { NativeDiagrams } from './uml-native.js';
import { DiagramDocuments, diagramLocator } from './uml-documents.js';
import { outputProblem } from './output-documents.js';
import { validDiff } from './output-contract.js';
import { begin, end, notes, region, handwritten, provenance, renderedSource, readState, statePath, type DiagramState } from './uml-state.js';

export const umlOutput: OutputRegistration = {
  id: 'uml', validate: options => [
    ...Object.keys(options).filter(key => key !== 'directory' && key !== 'views').map(key => ({ path: [key], message: 'Unknown diagram option.' })),
    ...(typeof options.directory !== 'string' || !literal(options.directory) || options.directory.split('/').some(part => part.toLowerCase() === '.expec')
      ? [{ path: ['directory'], message: 'Provide a relative directory outside .expec.' }] : []),
    ...(options.views !== undefined && (!Array.isArray(options.views) || !options.views.length || new Set(options.views).size !== options.views.length
      || options.views.some(view => view !== 'structure' && view !== 'interactions')) ? [{ path: ['views'], message: 'Select structure and/or interactions once.' }] : []),
  ], open: options => new DiagramOutput(options.directory as string, options.views as ('structure' | 'interactions')[] ?? ['structure']),
};
const refused = (problems: readonly Diagnostic[]): Check<OutputPlan> => ({ problems, deferred: [] });
const conflict = (path: string, message: string) => outputProblem('output-conflict', path, message);
const svgPath = (path: string) => path.replace(/\.d2$/i, '.svg');
const pathKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;

class DiagramOutput implements OutputAdapter {
  readonly id = 'uml';
  constructor(private readonly directory: string, private readonly views: ('structure' | 'interactions')[]) {}
  private stored(snapshot: ProjectSnapshot): { state?: DiagramState; problems: Diagnostic[] } {
    try {
      const state = readState(snapshot);
      return { ...state ? { state } : {}, problems: state && (state.directory !== this.directory || canonical(state.views) !== canonical(this.views))
        ? [outputProblem('output-options-changed', statePath, 'Output options require an explicit migration.')] : [] };
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Malformed or unsupported diagram generation state.')] }; }
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const engine = new NativeDiagrams();
    try {
      const documents = await DiagramDocuments.read(snapshot, engine), result = documents.read(id), stored = this.stored(snapshot);
      const artifacts = [...result.artifacts];
      // State can locate captured unreadable bytes; it cannot supply a native range or search fact.
      for (const prior of stored.state?.documents.filter(document => document.subjects.some(subject => subject.id === id)) ?? []) {
        if (!artifacts.some(artifact => artifact.file.path === prior.path)) {
          const file = snapshot.files.find(file => file.path === prior.path);
          if (file && documents.problems.some(problem => problem.at.kind === 'dependency' && problem.at.path.includes(prior.path))) artifacts.push({ at: diagramLocator(file.path, 'd2-unreadable', { subject: id }), file });
        }
      }
      const paths = new Set(artifacts.filter(artifact => /\.d2$/i.test(artifact.file.path)).map(artifact => artifact.file.path)), problems = [...result.problems, ...stored.problems];
      for (const path of paths) {
        const file = snapshot.files.find(file => file.path === svgPath(path));
        if (file && !artifacts.some(artifact => artifact.file.path === file.path)) artifacts.push({ at: diagramLocator(file.path, 'svg', { subject: id }), file });
        const metadata = file && renderedSource(file.bytes), source = snapshot.files.find(file => file.path === path)!;
        if (!metadata || metadata.source !== path || metadata.digest !== hash(source.bytes)) problems.push(outputProblem('stale-diagram-render', svgPath(path), 'The SVG does not describe the current source bytes.'));
      }
      return { ...result, artifacts, problems };
    } finally { await engine.dispose(); }
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const engine = new NativeDiagrams();
    try { const result = (await DiagramDocuments.read(snapshot, engine)).search(id); return { ...result, problems: [...result.problems, ...this.stored(snapshot).problems] }; }
    finally { await engine.dispose(); }
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return refused([...snapshot.problems, outputProblem('incomplete-project', '', 'A complete project snapshot is required.')]);
    if (new Set(snapshot.files.map(file => pathKey(file.path))).size !== snapshot.files.length
      || snapshot.files.some(file => !literal(file.path) || !(file.bytes instanceof Uint8Array) || file.version !== hash(file.bytes))) return refused([outputProblem('invalid-project-snapshot', '', 'Snapshot paths and versions must be valid and unique.')]);
    const stored = this.stored(snapshot); if (stored.problems.length) return refused(stored.problems);
    const engine = new NativeDiagrams();
    try {
      const documents = await DiagramDocuments.read(snapshot, engine), previous = stored.state, problems: Diagnostic[] = [];
      for (const prior of previous?.documents ?? []) {
        const source = documents.documents.get(prior.path), svg = snapshot.files.find(file => file.path === svgPath(prior.path));
        if (!source || source.problems.length) {
          const found = documents.problems.filter(problem => problem.at.kind === 'dependency' && problem.at.path.includes(prior.path));
          problems.push(...found.length ? found : [conflict(prior.path, 'Owned source is missing or unreadable.')]); continue;
        }
        if (source.limitations.length) problems.push(outputProblem('unsupported-diagram-syntax', prior.path, source.limitations.join('; ')));
        try { if (hash(Buffer.from(region(source.text).content)) !== prior.region) problems.push(conflict(prior.path, 'Generated source was edited.')); else problems.push(...handwritten(source)); }
        catch { problems.push(conflict(prior.path, 'Generated region is missing or ambiguous.')); }
        if (!svg || hash(svg.bytes) !== prior.svg) problems.push(conflict(svgPath(prior.path), 'Owned SVG was removed or edited.'));
      }
      if (problems.length) return refused(problems);
      const next: DiagramState = previous ? structuredClone(previous) : { format: 1, renderFormat: 1, directory: this.directory, views: this.views, context: '', documents: [], deleted: [] };
      const desired = new Map<string, { text: string; drawing: Omit<Drawing, 'text'> }>();
      if (request.operation === 'delete') {
        const owned = previous?.documents.find(document => document.subjects.some(subject => subject.id === request.id));
        if (!owned) {
          if (previous?.deleted.includes(request.id)) return success({ outputId: this.id, basedOn: snapshot, changes: [], artifacts: this.associations(previous, documents) });
          return refused([outputProblem('output-not-found', '', 'No owned diagram subject ' + request.id)]);
        }
        if (owned.subjects.find(subject => subject.id === request.id)?.owner) return refused([outputProblem('nested-delete', owned.path, 'Remove a nested declaration through specification update.')]);
        for (const prior of previous!.documents) {
          const source = documents.documents.get(prior.path)!, span = region(source.text);
          if (prior === owned && prior.view === 'interaction') {
            if (span.prefix || span.suffix !== notes) return refused([outputProblem('handwritten-document-content', prior.path, 'Preserve handwritten content before deleting this document.')]);
            continue;
          }
          const removed = new Set(prior === owned ? [request.id] : []);
          for (const subject of prior.subjects) if (subject.owner && removed.has(subject.owner)) removed.add(subject.id);
          const ranges = source.statements.filter(node => node.range.start >= span.start && node.range.end <= span.finish && (removed.has(String(node.metadata?.definition))
            || node.metadata?.edge && removed.has(String((node.metadata.edge as { subject?: unknown }).subject)) || [...removed].some(id => node.key[0]?.startsWith(nativeKey(id) + '_promise_'))))
            .map(node => ({ start: node.metadataStart ?? node.range.start, end: node.range.end }));
          let text = source.text;
          for (const range of ranges.sort((a, b) => b.start - a.start)) text = text.slice(0, range.start) + text.slice(range.end);
          desired.set(prior.path, { text, drawing: { view: prior.view, ...prior.id ? { id: prior.id } : {}, subjects: prior.subjects.filter(subject => !removed.has(subject.id)) } });
        }
      } else {
        const current = request.current;
        if (!current?.specification?.inspection || !current.baseline || typeof current.node !== 'function') throw new TypeError('Provide an identified checked specification.');
        if ('diff' in request && !validDiff(request.diff, current)) return refused([outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identities.')]);
        const known = new Set([...current.baseline.elements.map(record => record.id), ...current.baseline.retired]);
        if (previous && [...previous.deleted, ...previous.documents.flatMap(document => document.subjects.map(subject => subject.id))].some(id => !known.has(id))) return refused([outputProblem('unknown-output-identity', statePath, 'Current identity history omits rendered subjects.')]);
        const added = 'diff' in request ? new Set(request.diff.changes.filter(change => change.kinds.includes('add')).map(change => change.id)) : new Set<string>();
        if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')
          || change.kinds.includes('add') && change.after?.address.owner !== null && !added.has(change.after!.address.owner!)))) return refused([outputProblem('not-addition-only', '', 'Insert accepts top-level additions; use update for existing contracts.')]);
        if (this.views.includes('interactions') && ![...current.specification.inspection.query('interaction')].length) return refused([outputProblem('missing-interaction', '', 'No authored interaction is available.')]);
        const drawings = [...this.views.includes('structure') ? [structure(current)] : [], ...this.views.includes('interactions') ? interactions(current) : []];
        for (const drawing of drawings) {
          const path = this.directory + (drawing.view === 'structure' ? '/structure.d2' : '/interactions/' + hash(Buffer.from(drawing.id!)) + '.d2');
          const prior = previous?.documents.find(document => document.path === path), source = prior && documents.documents.get(path), span = source && region(source.text);
          desired.set(path, { drawing, text: (span?.prefix ?? '') + begin + drawing.text + end + (span?.suffix ?? notes) });
        }
        next.context = current.baseline.context;
        if (previous && request.operation === 'create' && (previous.context !== next.context || previous.documents.some(prior => !desired.has(prior.path)
          || hash(Buffer.from(desired.get(prior.path)!.text)) !== prior.rendered))) return refused([outputProblem('use-update', statePath, 'Existing diagrams or notes changed; use update.')]);
      }
      const remaining = new Set([...desired.values()].flatMap(value => value.drawing.subjects.map(subject => subject.id)));
      for (const prior of previous?.documents ?? []) if (!desired.has(prior.path)) {
        const span = region(documents.documents.get(prior.path)!.text);
        if (span.prefix || span.suffix !== notes) problems.push(outputProblem('handwritten-document-content', prior.path, 'Preserve handwritten content before removing a complete document.'));
      }
      const removed = (previous?.documents.flatMap(document => document.subjects.map(subject => subject.id)) ?? []).filter(id => !remaining.has(id));
      if (removed.length && !documents.coverage().complete) return refused([outputProblem('incomplete-output-search', '', 'Native incoming coverage is incomplete; removal is unsafe.')]);
      for (const id of removed) for (const use of documents.search(id).incoming.uses) {
        const value = use.at.value as { path: string; range?: { start: number } }, prior = previous?.documents.find(document => document.path === value.path);
        const source = prior && documents.documents.get(prior.path), span = source && region(source.text);
        if (!prior || !span || value.range === undefined || value.range.start < span.start || value.range.start >= span.finish
          || request.operation === 'delete' && use.target.kind === 'specified' && !removed.includes(use.target.id)) problems.push(conflict(value.path, 'A remaining incoming native use prevents removal.'));
      }
      for (const [path, value] of desired) {
        const prior = previous?.documents.find(document => document.path === path);
        if (!prior && snapshot.files.some(file => pathKey(file.path) === pathKey(path) || pathKey(file.path) === pathKey(svgPath(path)))) problems.push(conflict(path, 'An existing diagram is not owned by this output.'));
        if ([path, svgPath(path), statePath].some(path => path.split('/').some(part => snapshot.excludeNames.includes(part)))) problems.push(conflict(path, 'Output destination is excluded.'));
        for (const subject of value.drawing.subjects) for (const definition of documents.definitions.filter(definition => definition.id === subject.id)) {
          if (!previous?.documents.some(document => document.path === definition.file.path && document.subjects.some(value => value.id === subject.id))) problems.push(conflict(definition.file.path, 'Another unowned definition claims the same identity.'));
        }
      }
      if (problems.length) return refused(problems);
      const sources = Object.fromEntries([...desired].map(([path, value]) => [path, value.text])), changes: FileChange[] = [], confirmed = new DiagramDocuments(snapshot);
      next.documents = []; next.deleted = [...new Set([...(previous?.deleted ?? []), ...removed])].filter(id => !remaining.has(id)).sort();
      for (const [path, value] of desired) {
        const document = await engine.read(path, sources);
        if (document.problems.length) return refused(document.problems);
        if (document.limitations.length) return refused([outputProblem('unsupported-diagram-syntax', path, document.limitations.join('; '))]);
        const notesProblems = handwritten(document); if (notesProblems.length) return refused(notesProblems);
        const before = documents.documents.get(path);
        if (request.operation === 'insert' && before) {
          const old = region(before.text), existing = before.statements.filter(node => node.range.start >= old.start && node.range.end <= old.finish);
          const proposed = document.statements.map(node => document.text.slice(node.range.start, node.range.end));
          for (const statement of existing) {
            const text = before.text.slice(statement.range.start, statement.range.end), index = proposed.indexOf(text);
            if (index < 0) return refused([outputProblem('not-addition-only', path, 'A previously rendered native contract changed; use update.')]);
            proposed.splice(index, 1);
          }
        }
        const prior = previous?.documents.find(document => document.path === path), rendered = hash(Buffer.from(value.text));
        let svg: string;
        try { svg = prior?.rendered === rendered ? Buffer.from(snapshot.files.find(file => file.path === svgPath(path))!.bytes).toString()
          : provenance(path, value.text, await engine.render(document)); }
        catch (error) { return refused([outputProblem('native-render-failed', path, String(error))]); }
        next.documents.push({ path, view: value.drawing.view, ...value.drawing.id ? { id: value.drawing.id } : {}, region: hash(Buffer.from(region(value.text).content)),
          rendered, svg: hash(Buffer.from(svg)), subjects: value.drawing.subjects });
        confirmed.add(document, { path, bytes: Buffer.from(value.text), version: rendered });
        for (const [destination, text] of [[path, value.text], [svgPath(path), svg]] as const) if (!snapshot.files.some(file => file.path === destination && hash(file.bytes) === hash(Buffer.from(text)))) changes.push({ kind: 'write', path: destination, bytes: Buffer.from(text) });
      }
      for (const prior of previous?.documents ?? []) if (!desired.has(prior.path)) changes.push({ kind: 'remove', path: prior.path }, { kind: 'remove', path: svgPath(prior.path) });
      const bytes = Buffer.from(canonical(next, 2) + '\n');
      if (!snapshot.files.some(file => file.path === statePath && hash(file.bytes) === hash(bytes))) changes.push({ kind: 'write', path: statePath, bytes });
      return success({ outputId: this.id, basedOn: snapshot, changes, artifacts: this.associations(next, confirmed) });
    } finally { await engine.dispose(); }
  }
  private associations(state: DiagramState, observed: DiagramDocuments): ArtifactAssociation[] {
    return state.documents.flatMap(document => document.subjects.flatMap(subject => {
      const definition = observed.definitions.find(definition => definition.id === subject.id && definition.file.path === document.path);
      if (!definition) throw Error('Rendered subject has no actual native definition: ' + subject.id);
      return [{ specId: subject.id, locator: definition.at }, { specId: subject.id, locator: diagramLocator(svgPath(document.path), 'svg', { subject: subject.id }) }];
    }));
  }
}
