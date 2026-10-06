import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectFile, ProjectSnapshot } from '../connection/project-connection.js';
import type { ProjectRead, ProjectSearch } from '../connection/project-inspection.js';
import type { ArtifactLocator, JsonValue, RelationshipObservation } from '../../model/specification-identity.js';
import { NativeDiagrams, type NativeRead, type NativeStatement } from './uml-native.js';
import { outputProblem } from './output-documents.js';

type Target = RelationshipObservation['uses'][number]['target'];
type Definition = { id: string; file: ProjectFile; at: ArtifactLocator; owners: string[] };
type Use = { source: Target; target: Target; owners: string[]; at: ArtifactLocator };
export const diagramLocator = (path: string, format: string, value: Record<string, JsonValue> = {}): ArtifactLocator => ({ outputId: 'uml', format, value: { path, ...value } });
const specified = (id: string): Target => ({ kind: 'specified', id });
const project = (path: string, key: string): Target => ({ kind: 'project', id: path + '#' + key });
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Reads identities and actual relationships from captured native syntax, never generation state. */
export class DiagramDocuments {
  readonly documents = new Map<string, NativeRead>();
  readonly definitions: Definition[] = [];
  readonly uses: Use[] = [];
  readonly problems: Diagnostic[] = [];
  readonly limitations: string[] = [];
  constructor(readonly snapshot: ProjectSnapshot) { this.problems.push(...snapshot.problems); }
  add(document: NativeRead, file: ProjectFile): void {
    this.documents.set(file.path, document); this.problems.push(...document.problems); this.limitations.push(...document.limitations);
    if (!document.problems.length) this.collect(document, file);
  }
  static async read(snapshot: ProjectSnapshot, engine: NativeDiagrams): Promise<DiagramDocuments> {
    const result = new DiagramDocuments(snapshot), files: Record<string, string> = {};
    for (const file of snapshot.files.filter(file => /\.d2$/i.test(file.path))) {
      try { files[file.path] = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
      catch { result.problems.push(outputProblem('invalid-output-document', file.path, file.path + ': invalid UTF-8')); }
    }
    for (const [path] of Object.entries(files)) {
      result.add(await engine.read(path, files), snapshot.files.find(file => file.path === path)!);
    }
    const seen = new Set<string>();
    for (const definition of result.definitions) {
      if (seen.has(definition.id)) result.problems.push(outputProblem('ambiguous-definition', definition.file.path, 'Multiple actual definitions claim ' + definition.id));
      seen.add(definition.id);
    }
    return result;
  }
  private collect(document: NativeRead, file: ProjectFile): void {
    const roots = new Map<string, { target: Target; owners: string[] }>();
    const at = (node: NativeStatement, format: string, extra: Record<string, JsonValue> = {}): ArtifactLocator => diagramLocator(file.path, format,
      { range: { ...node.range }, keyRange: { ...node.keyRange }, ...extra });
    if (document.interaction) this.definitions.push({ id: document.interaction, file, owners: [], at: diagramLocator(file.path, 'd2-document', { subject: document.interaction }) });
    for (const node of document.statements) {
      if (node.edges.length || node.key.length !== 1) continue;
      const key = node.key[0]!, data = node.metadata, id = data?.definition ?? data?.reference;
      if (id !== undefined && typeof id !== 'string') { this.issue(file.path, 'Malformed native subject identity.'); continue; }
      const owner = typeof data?.owner === 'string' ? data.owner : undefined;
      roots.set(key, { target: id ? specified(id) : project(file.path, key), owners: [id, owner].filter((value): value is string => !!value) });
      if (data?.definition) {
        this.definitions.push({ id: id!, file, owners: owner ? [owner] : [], at: at(node, 'd2-object', { subject: id!, key }) });
        if (data.type !== undefined) {
          if (typeof data.type !== 'string') this.issue(file.path, 'Malformed participant type reference.');
          else this.uses.push({ source: specified(id!), target: specified(data.type), owners: [id!, ...owner ? [owner] : []], at: at(node, 'd2-type-reference') });
        }
      }
      for (const member of node.children.filter(child => child.metadata)) {
        const data = member.metadata!;
        if (typeof data.member !== 'string' || data.owner !== key || !Array.isArray(data.parameters) || data.parameters.some(value => typeof value !== 'string') || !id) {
          this.issue(file.path, 'Class member metadata does not match its actual immediate owner.'); continue;
        }
        if (data.member !== id) this.definitions.push({ id: data.member, file, owners: [id], at: at(member, 'd2-member', { subject: data.member, owner: key }) });
        for (const parameter of data.parameters as string[]) this.definitions.push({ id: parameter, file, owners: [data.member, id],
          at: at(member, 'd2-signature', { subject: parameter, containing: data.member }) });
      }
    }
    const endpoint = (key: string) => roots.get(key) ?? { target: project(file.path, key), owners: [] };
    for (const node of document.statements) {
      if (node.key.length === 2 && node.key[1] === 'note') {
        const target = endpoint(node.key[0]!).target;
        this.uses.push({ source: project(file.path, 'note@' + node.range.start), target, owners: [], at: at(node, 'd2-note') });
      }
      for (const edge of node.edges) {
        if (edge.from.length !== 1 || edge.to.length !== 1) continue;
        const from = endpoint(edge.from[0]!), to = endpoint(edge.to[0]!);
        const location = (reverse = false): ArtifactLocator => diagramLocator(file.path, 'd2-edge', { range: { ...edge.range },
          sourceRange: { ...reverse ? edge.toRange : edge.fromRange }, targetRange: { ...reverse ? edge.fromRange : edge.toRange } });
        if (node.metadata?.edge) {
          const role = record(node.metadata.edge), fromOwner = from.target.kind === 'specified' && from.target.id === role.owner,
            toOwner = to.target.kind === 'specified' && to.target.id === role.owner;
          if (typeof role.subject !== 'string' || typeof role.owner !== 'string' || !['dependency', 'input', 'output', 'construction', 'field', 'alias', 'failure', 'failure-type-argument'].includes(String(role.role)) || !fromOwner && !toOwner) {
            this.issue(file.path, 'Typed role metadata does not match its actual endpoint.'); continue;
          }
          this.uses.push({ source: specified(role.subject), target: fromOwner ? to.target : from.target, owners: [role.subject, role.owner], at: location(!fromOwner) });
        } else {
          if (edge.right || !edge.left) this.uses.push({ source: from.target, target: to.target, owners: from.owners, at: location() });
          if (edge.left || !edge.right) this.uses.push({ source: to.target, target: from.target, owners: to.owners, at: location(true) });
        }
        if (node.metadata?.message) {
          const message = record(node.metadata.message);
          if (typeof message.operation !== 'string' || message.interaction !== document.interaction || !Number.isSafeInteger(message.ordinal)) this.issue(file.path, 'Malformed message reference.');
          else this.uses.push({ source: from.target, target: specified(message.operation), owners: [...from.owners, document.interaction!], at: location() });
        }
      }
    }
  }
  private issue(path: string, message: string): void { this.problems.push(outputProblem('invalid-output-document', path, path + ': ' + message)); }
  coverage(): RelationshipObservation['coverage'] {
    const limitations = [...this.limitations, ...this.problems.map(problem => problem.message), ...this.snapshot.complete ? [] : ['Project snapshot is incomplete.']];
    return { complete: !limitations.length, limitations, scope: [diagramLocator('', 'scope', { description: 'Flat root D2 objects, immediate class members and explicit edges',
      paths: this.snapshot.files.filter(file => /\.d2$/i.test(file.path)).map(file => file.path), excludeNames: [...this.snapshot.excludeNames], excluded: [...this.snapshot.excluded] })] };
  }
  read(subject: string): ProjectRead {
    const definitions = this.definitions.filter(definition => definition.id === subject), paths = new Set(definitions.map(definition => definition.file.path));
    const artifacts = definitions.map(definition => ({ at: definition.at, file: definition.file }));
    for (const path of paths) {
      const svg = this.snapshot.files.find(file => file.path === path.replace(/\.d2$/i, '.svg'));
      if (svg) artifacts.push({ at: diagramLocator(svg.path, 'svg', { subject }), file: svg });
    }
    return { artifacts, coverage: this.coverage(), problems: [...this.problems, ...definitions.length ? [] : [outputProblem('output-not-found', '', 'No actual native definition for ' + subject)]] };
  }
  search(subject: string): ProjectSearch {
    return { definitions: this.definitions.filter(definition => definition.id === subject).map(definition => definition.at), problems: [...this.problems],
      incoming: { subject, direction: 'incoming', coverage: this.coverage(), unresolved: [], uses: this.uses.filter(use => use.target.kind === 'specified' && use.target.id === subject).map(use => ({ target: use.source, at: use.at })) },
      outgoing: { subject, direction: 'outgoing', coverage: this.coverage(), unresolved: [], uses: this.uses.filter(use => use.owners.includes(subject)).map(use => ({ target: use.target, at: use.at })) } };
  }
}
