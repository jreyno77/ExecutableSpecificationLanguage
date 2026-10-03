import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';
import { posix } from 'node:path';
import type { Diagnostic } from './checking.js';
import type { ProjectFile, ProjectSnapshot } from './project-connection.js';
import type { ArtifactLocator, RelationshipObservation } from './specification-identity.js';
import type { ProjectRead, ProjectSearch } from './project-inspection.js';
import { anchor, flatten, type ListedDeclaration } from './output-projection.js';
import { identifier } from './identity-baseline.js';

export type ListFormat = 'markdown' | 'structure';
export const outputProblem = (code: string, path: string, message: string): Diagnostic => ({ code, message, at: { kind: 'dependency', path: ['project', path] }, related: [] });
export const artifact = (outputId: string, format: ListFormat, path: string, subject?: string): ArtifactLocator => ({ outputId,
  format: format === 'markdown' ? 'expec-markdown-section-1' : 'expec-structure-1', value: { path, ...(subject ? { anchor: anchor(subject) } : {}) } });
const escape = (text: string): string => text.replace(/[\\`*_[\]<>#!]/g, '\\$&').replace(/[\r\n]/g, ' ');
export function renderList(format: ListFormat, id: string, path: string, declaration: ListedDeclaration,
  locations: ReadonlyMap<string, { path: string; name: string }>): Uint8Array {
  if (format === 'structure') return Buffer.from(JSON.stringify({ format: 'expec-structure-1', outputId: id, declaration }, null, 2) + '\n');
  const link = (reference: ListedDeclaration['references'][number]): string => {
    const target = reference.specId ? locations.get(reference.specId) : undefined;
    if (!target?.path) return escape(target?.name ?? reference.specId ?? reference.path ?? 'unavailable reference');
    const destination = posix.relative(posix.dirname(path), target.path).split('/').map(encodeURIComponent).join('/') + '#' + anchor(reference.specId!);
    return '[' + escape(target.name) + '](' + destination + ')';
  };
  const section = (node: ListedDeclaration, depth: number): string => {
    const metadata = Buffer.from(JSON.stringify({ outputId: id, specId: node.specId })).toString('hex');
    const dependency = node.references.filter(reference => reference.role === 'dependency'), other = node.references.filter(reference => reference.role !== 'dependency');
    return `<!-- expec-section:${metadata} -->\n\n${'#'.repeat(Math.min(depth, 6))} ${escape(node.error ? 'error type' : node.kind)} ${escape(node.name)}\n\n<a id="${anchor(node.specId!)}"></a>\n\n`
      + (depth === 1 ? 'Contract summary; declared behavior is not verified.\n\n' : '')
      + (node.signature ? '```expec\n' + node.signature.replace(/```/g, '` ` `') + '\n```\n\n' : '')
      + (dependency.length ? 'Depends on: ' + dependency.map(link).join(', ') + '\n\n' : '')
      + other.map(reference => (reference.role === 'failure' ? 'May fail with' : reference.role) + ': ' + link(reference) + '\n\n').join('')
      + (node.promises ?? []).map(text => 'Unverified promise: ' + escape(text) + '\n\n').join('')
      + node.members.map(member => section(member, depth + 1)).join('')
      + `<!-- expec-end:${Buffer.from(node.specId!).toString('hex')} -->\n\n`;
  };
  return Buffer.from(section(declaration, 1));
}
type Definition = { id: string; at: ArtifactLocator; file: ProjectFile; ancestors: string[] };
type Link = { at: ArtifactLocator; path: string; projectId: string; source: string | undefined; owners: string[]; destination: string; byId: boolean };
type Edge = Link & { target?: RelationshipObservation['uses'][number]['target']; reason?: string };

/** Discovers definitions and uses in actual target-native project bytes. */
export class ListDocuments {
  readonly definitions: Definition[] = [];
  readonly problems: Diagnostic[] = [];
  readonly edges: Edge[] = [];
  private readonly anchors = new Set<string>();
  readonly scope: ArtifactLocator[];
  constructor(readonly format: ListFormat, readonly id: string, readonly snapshot: ProjectSnapshot) {
    this.problems.push(...snapshot.problems);
    this.scope = [{ outputId: id, format: 'scope', value: { description: format === 'markdown'
      ? 'Markdown definitions and links' : 'expec-structure-1 documents for ' + id,
      paths: snapshot.files.filter(file => format === 'markdown' ? /\.(md|markdown)$/i.test(file.path) : file.path.endsWith('.structure.json')).map(file => file.path),
      excludeNames: [...snapshot.excludeNames], excluded: [...snapshot.excluded] } }];
    const links: Link[] = [];
    for (const file of snapshot.files) {
      if (format === 'markdown' && /\.(md|markdown)$/i.test(file.path)) this.markdown(file, links);
      if (format === 'structure' && file.path.endsWith('.structure.json')) this.structure(file, links);
    }
    for (const link of links) this.edges.push(this.resolve(link));
    const groups = new Map<string, Definition[]>();
    for (const definition of this.definitions) { const group = groups.get(definition.id) ?? []; group.push(definition); groups.set(definition.id, group); }
    for (const [subject, group] of groups) if (group.length > 1) for (const definition of group) this.problems.push(outputProblem('ambiguous-definition', definition.file.path, 'Multiple definitions claim ' + subject));
  }
  private issue(path: string, message: string): void { this.problems.push(outputProblem('invalid-output-document', path, message)); }
  private markdown(file: ProjectFile, links: Link[]): void {
    const text = Buffer.from(file.bytes).toString('utf8'), tree = fromMarkdown(text), stack: { id: string; outputId: string; depth?: number }[] = [];
    const references = new Map<string, string>(), pending: { node: RootContent; owners: string[] }[] = [];
    let root: string | undefined, waiting = false;
    const rememberAnchor = (): void => {
      const current = stack.at(-1);
      if (current) this.anchors.add(file.path + '#' + anchor(current.id));
    };
    const visit = (node: RootContent): void => {
      if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'image' || node.type === 'imageReference') return;
      if (node.type === 'paragraph' && node.children.length === 2 && node.children[0]?.type === 'html' && node.children[1]?.type === 'html'
        && node.children[0].value === `<a id="${anchor(stack.at(-1)?.id ?? '')}">` && node.children[1].value === '</a>') { rememberAnchor(); return; }
      if (node.type === 'html') {
        const start = /^<!-- expec-section:([a-f0-9]+) -->$/.exec(node.value), end = /^<!-- expec-end:([a-f0-9]+) -->$/.exec(node.value);
        if (start) {
          try {
            const data = JSON.parse(Buffer.from(start[1]!, 'hex').toString('utf8'));
            if (typeof data.outputId !== 'string' || !data.outputId.trim() || !identifier.safeParse(data.specId).success || Object.keys(data).sort().join(',') !== 'outputId,specId') throw new Error('Invalid metadata');
            if (waiting || stack.some(item => item.id === data.specId || item.outputId !== data.outputId)) throw new Error('Unbalanced metadata');
            const ancestors = stack.map(item => item.id); stack.push({ id: data.specId, outputId: data.outputId }); waiting = true;
            if (data.outputId === this.id) {
              root ??= data.specId;
              this.definitions.push({ id: data.specId, at: artifact(this.id, this.format, file.path, data.specId), file, ancestors });
            }
          } catch { this.issue(file.path, 'Malformed or unbalanced identity metadata.'); }
        } else if (end) {
          if (waiting || stack.pop()?.id !== Buffer.from(end[1]!, 'hex').toString('utf8')) this.issue(file.path, 'Unbalanced identity metadata.');
        } else if (node.value === `<a id="${anchor(stack.at(-1)?.id ?? '')}"></a>`) rememberAnchor();
        else this.issue(file.path, 'Unsupported HTML or malformed identity metadata.');
        return;
      }
      if (node.type === 'heading' && stack.length) {
        const current = stack.at(-1)!;
        if (waiting) {
          const parent = stack.at(-2)?.depth;
          if (parent !== undefined && node.depth <= parent && !(parent === 6 && node.depth === 6)) this.issue(file.path, 'Section headings disagree with identity nesting.');
          current.depth = node.depth; waiting = false;
        } else if (current.depth !== undefined && node.depth <= current.depth) this.issue(file.path, 'Heading escapes its identity section.');
      }
      if (node.type === 'definition') references.set(node.identifier.toUpperCase(), node.url);
      if (node.type === 'link' || node.type === 'linkReference') pending.push({ node, owners: stack.length ? stack.filter(item => item.outputId === this.id).map(item => item.id) : root ? [root] : [] });
      if ('children' in node) for (const child of node.children) visit(child as RootContent);
    };
    tree.children.forEach(visit);
    if (stack.length || waiting) this.issue(file.path, 'Unclosed identity section.');
    for (const { node, owners } of pending) {
      const destination = node.type === 'link' ? node.url : node.type === 'linkReference' ? references.get(node.identifier.toUpperCase()) : undefined;
      if (destination === undefined) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination)) continue;
      links.push({ at: { outputId: this.id, format: 'markdown-link', value: { path: file.path, offset: node.position?.start.offset ?? 0 } }, path: file.path, projectId: file.path, source: owners.at(-1), owners, destination, byId: false });
    }
  }
  private structure(file: ProjectFile, links: Link[]): void {
    try {
      const data: unknown = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
      if (data && typeof data === 'object' && 'outputId' in data && typeof data.outputId === 'string' && data.outputId !== this.id) return;
      if (!data || typeof data !== 'object' || !('format' in data) || data.format !== 'expec-structure-1' || !('outputId' in data) || data.outputId !== this.id || !('declaration' in data)) throw new Error('Unknown structural document format.');
      const visit = (value: unknown, owners: string[], location: string): void => {
        const node = value as ListedDeclaration;
        if (!node || typeof node !== 'object' || typeof node.kind !== 'string' || typeof node.name !== 'string'
          || !Array.isArray(node.references) || !Array.isArray(node.members)
          || node.specId !== undefined && !identifier.safeParse(node.specId).success
          || node.error !== undefined && typeof node.error !== 'boolean') throw new Error('Malformed structural declaration.');
        if (node.specId) { this.definitions.push({ id: node.specId, at: artifact(this.id, this.format, file.path, node.specId), file, ancestors: owners }); owners = [...owners, node.specId]; }
        node.references.forEach((reference, index) => {
          if (!reference || !['dependency', 'input', 'output', 'failure', 'field', 'construction', 'use'].includes(reference.role)
            || (reference.specId === undefined) === (reference.path === undefined) || typeof (reference.specId ?? reference.path) !== 'string') throw new Error('Malformed structural reference.');
          links.push({ at: { outputId: this.id, format: 'structural-reference', value: { path: file.path, pointer: `${location}/references/${index}` } },
            path: file.path, projectId: file.path + '#' + location, source: node.specId, owners, destination: reference.specId ?? reference.path!, byId: reference.specId !== undefined });
        });
        node.members.forEach((member, index) => visit(member, owners, `${location}/members/${index}`));
      };
      visit(data.declaration, [], '/declaration');
    } catch (error) { this.issue(file.path, error instanceof Error ? error.message : 'Invalid structural document.'); }
  }
  private resolve(link: Link): Edge {
    const unresolved = (reason: string): Edge => ({ ...link, reason });
    let selected: Definition[];
    if (link.byId) selected = this.definitions.filter(definition => definition.id === link.destination);
    else {
      let path: string, fragment: string;
      try {
        const index = link.destination.indexOf('#'), address = index < 0 ? link.destination : link.destination.slice(0, index);
        fragment = index < 0 ? '' : decodeURIComponent(link.destination.slice(index + 1));
        if (address.includes('?') || address.startsWith('/') || address.includes('\\')) return unresolved('Unsupported project URL: ' + link.destination);
        path = this.format === 'structure' ? posix.normalize(address) : posix.normalize(posix.join(posix.dirname(link.path), decodeURIComponent(address || posix.basename(link.path))));
      } catch { return unresolved('Invalid URL escaping: ' + link.destination); }
      if (path === '..' || path.startsWith('../')) return unresolved('Link leaves project: ' + link.destination);
      const file = this.snapshot.files.find(file => file.path === path);
      if (!file) return unresolved('Missing project link: ' + link.destination);
      if (this.format === 'markdown' && fragment && !this.anchors.has(path + '#' + fragment)) return unresolved('Missing project anchor: ' + link.destination);
      selected = this.definitions.filter(definition => definition.file.path === path && (fragment ? anchor(definition.id) === fragment : !definition.ancestors.length));
      if (!selected.length && fragment && this.anchors.has(path + '#' + fragment)) return { ...link, target: { kind: 'project', id: path + '#' + fragment } };
      if (!selected.length && !fragment) return { ...link, target: { kind: 'project', id: path } };
    }
    if (selected.length !== 1 || this.definitions.filter(definition => definition.id === selected[0]!.id).length !== 1) return unresolved('Missing or ambiguous definition: ' + link.destination);
    return { ...link, target: { kind: 'specified', id: selected[0]!.id } };
  }
  read(subject: string): ProjectRead {
    const definitions = this.definitions.filter(definition => definition.id === subject);
    return { artifacts: definitions.map(definition => ({ at: definition.at, file: definition.file })), coverage: this.coverage(),
      problems: definitions.length ? [...this.problems] : [...this.problems, outputProblem('output-not-found', '', 'No rendered definition for ' + subject)] };
  }
  search(subject: string): ProjectSearch {
    const relevant = this.edges.filter(edge => edge.owners.includes(subject));
    const outgoing = relevant.flatMap(edge => edge.target ? [{ target: edge.target, at: edge.at }] : []);
    const incoming = this.edges.filter(edge => edge.target?.kind === 'specified' && edge.target.id === subject)
      .map(edge => ({ target: edge.source ? { kind: 'specified' as const, id: edge.source } : { kind: 'project' as const, id: edge.projectId }, at: edge.at }));
    const observation = (direction: 'incoming' | 'outgoing', edges: Edge[], uses: RelationshipObservation['uses']): RelationshipObservation => {
      const unresolved = edges.filter(edge => edge.reason).map(edge => ({ at: edge.at, reason: edge.reason! }));
      return { subject, direction, coverage: this.coverage(unresolved.length ? ['Some links could not be resolved.'] : []), uses, unresolved };
    };
    return { definitions: this.definitions.filter(definition => definition.id === subject).map(definition => definition.at),
      incoming: observation('incoming', this.edges, incoming), outgoing: observation('outgoing', relevant, outgoing), problems: [...this.problems] };
  }
  private coverage(extra: string[] = []): RelationshipObservation['coverage'] {
    const limitations = [...this.problems.map(problem => problem.message), ...extra];
    if (!this.snapshot.complete && !limitations.length) limitations.push('Project snapshot is incomplete.');
    return { scope: this.scope, complete: !limitations.length, limitations };
  }
}
