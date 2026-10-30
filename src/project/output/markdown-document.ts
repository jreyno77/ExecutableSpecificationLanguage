import { posix, dirname, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutputContext } from './output.js';
import { pageStart, pageEnd, navigationStart, navigationEnd } from './markdown-page.js';
import type { Item } from '../../model/inspection-item.js';
import type { NodeId } from '../../model/model.js';
import type { IdentifiedSpecification } from '../../model/specification-identity.js';
import type { TypeId } from '../../compiler/types.js';
import { anchor } from './output-projection.js';
import { language, UnsupportedLanguage } from '../../language/language-text.js';

export const emptyNotes = '## Your notes\n\nEdit this area for your own notes. Content above it is generated from .expec.\n\n';
export interface MarkdownPage { kind: 'home' | 'source'; key: string; path: string; region: Uint8Array; subjects: string[] }
export class MarkdownLayoutError extends Error { constructor(readonly sourceId: string, message: string) { super(message); } }
export const sectionStart = (id: string): string => '<!-- expec-section:' + Buffer.from(JSON.stringify({ outputId: 'markdown', specId: id })).toString('hex') + ' -->';
export const sectionEnd = (id: string): string => '<!-- expec-end:' + Buffer.from(id).toString('hex') + ' -->';
export const markdownText = (text: string): string => text.replace(/[\\`*_[\]<>#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
const fence = (text: string): string => {
  const delimiter = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return delimiter + 'expec\n' + text + '\n' + delimiter + '\n\n';
};
const scope = 'Statically checked specification. Runtime behavior is not verified by this document.';

/** Groups the existing inspected subjects into reader pages, retaining their persistent identities. */
export class MarkdownDocumentation {
  private readonly inspection;
  private readonly records;
  private readonly items = new Map<string, Item>();
  private readonly children = new Map<string, string[]>();
  private readonly page = new Map<string, { key: string; path: string }>();
  private readonly sources = new Map<string, { module: string; path: string; roots: string[] }>();
  constructor(private readonly current: IdentifiedSpecification, private readonly directory: string, sourceRoot = '.', context?: OutputContext) {
    this.inspection = current.specification.inspection;
    this.records = current.baseline.elements.filter(record => record.origin.kind === 'source');
    const add = (source: string, module: string) => {
      if (!this.sources.has(source)) this.sources.set(source, { module, path: this.destination(source, sourceRoot, context), roots: [] });
    };
    const external = new Set<string>();
    for (const node of this.inspection.roots()) {
      if (node.origin.kind === 'source') add(node.origin.node.sourceId, node.origin.module);
      else if (node.origin.kind === 'external') external.add(node.origin.module);
    }
    for (const record of this.records) {
      if (record.origin.kind !== 'source') continue;
      add(record.origin.node.sourceId, record.origin.module);
      this.items.set(record.id, this.inspection.read(current.node(record.id)));
    }
    for (const module of context?.workspaceModules ?? []) if (!external.has(module) && ![...this.sources.values()].some(source => source.module === module)) add(module, module);
    if (![...this.sources.values()].some(source => source.module === current.baseline.entry)) add(current.baseline.entry, current.baseline.entry);
    for (const record of this.records) {
      if (record.origin.kind !== 'source') continue;
      const source = this.sources.get(record.origin.node.sourceId)!;
      this.page.set(record.id, { key: record.origin.node.sourceId, path: source.path });
      const owner = record.address.owner ? this.records.find(candidate => candidate.id === record.address.owner) : undefined;
      if (owner?.origin.kind === 'source' && owner.origin.node.sourceId === record.origin.node.sourceId)
        this.children.set(owner.id, [...this.children.get(owner.id) ?? [], record.id]);
      else source.roots.push(record.id);
    }
    for (const source of this.sources.values()) source.roots.sort((a, b) => {
      const left = this.items.get(a)!.origin, right = this.items.get(b)!.origin;
      return left.kind === 'source' && right.kind === 'source' ? left.range.start.offset - right.range.start.offset : 0;
    });
  }
  private destination(source: string, sourceRoot: string, context?: OutputContext): string {
    try {
      let within: string;
      if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
        const uri = new URL(source);
        if (uri.protocol !== 'file:' || uri.href.includes('?') || uri.href.includes('#') || !context?.manifestLocation)
          throw Error('Provide a local file source URI and a native manifest context.');
        within = relative(resolve(dirname(context.manifestLocation), sourceRoot), fileURLToPath(uri)).split(sep).join('/');
      } else within = posix.relative(posix.normalize(sourceRoot), source);
      if (!within || isAbsolute(within) || within.split('/').some(part => !part || part === '.' || part === '..') || /[\\:*?<>|\[\]{}#%"\x00-\x1f]/.test(within))
        throw Error('Source must have a literal path inside the configured source root.');
      const name = within.endsWith('.expec') ? within.slice(0, -6) + '.md' : within + '.md';
      if (name.split('/').some(part => part.toLowerCase() === '.expec' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))
        throw Error('Source page filename is not portable.');
      return this.directory + '/pages/' + name;
    } catch (error) { throw new MarkdownLayoutError(source, error instanceof Error ? error.message : String(error)); }
  }
  render(): MarkdownPage[] {
    const pages: MarkdownPage[] = [], homePath = this.directory + '/Home.md';
    const sources = [...this.sources].sort((a, b) => a[1].path < b[1].path ? -1 : a[1].path > b[1].path ? 1 : 0);
    for (const [key, source] of sources) {
      const subjects: string[] = [];
      const visible = source.path.slice((this.directory + '/pages/').length).replace(/\.md$/, '');
      const toc = (id: string, depth = 0): string[] => {
        const node = this.items.get(id)!;
        const leaf = ['field', 'parameter', 'type-parameter', 'participant'].includes(node.kind);
        return [...leaf ? [] : ['  '.repeat(depth) + '- [' + markdownText(this.label(node)) + '](#' + anchor(id) + ')'], ...(this.children.get(id) ?? []).flatMap(child => toc(child, depth + (leaf ? 0 : 1)))];
      };
      const back = posix.relative(posix.dirname(source.path), homePath);
      let text = pageStart({ outputId: 'markdown', kind: 'source', key }) + '\n\n# ' + markdownText(visible) + '\n\n'
        + navigationStart + '\n\n[Home](' + back + ')\n\n## Contents\n\n' + source.roots.flatMap(id => toc(id)).join('\n') + '\n\n' + navigationEnd + '\n\n';
      for (const id of source.roots) text += this.section(id, 2, subjects);
      text += 'Source: ' + markdownText(visible + (key.endsWith('.expec') ? '.expec' : '')) + '\n\n' + scope + '\n\n' + pageEnd(key) + '\n\n';
      pages.push({ kind: 'source', key, path: source.path, region: Buffer.from(text), subjects });
    }
    return [renderMarkdownHome(this.directory, pages), ...pages];
  }

  private label(node: Item): string { return 'name' in node ? node.name : 'title' in node ? node.title.value : node.kind === 'examples' ? 'Examples' : node.kind === 'construction' ? 'Construction' : node.kind; }
  private link(target: NodeId, from: string): string {
    const node = this.inspection.read(target), label = markdownText(this.label(node));
    if (node.origin.kind === 'builtin') return label;
    const page = this.page.get(this.current.id(target));
    if (!page) return label + ' — ' + markdownText(node.origin.module) + (node.origin.kind === 'external' ? ' — External implementation not assessed' : '');
    const url = (page.path === from ? '' : posix.relative(posix.dirname(from), page.path).split('/').map(encodeURIComponent).join('/')) + '#' + anchor(this.current.id(target));
    return '[' + label + '](' + url + ')';
  }
  private callLink(target: NodeId, from: string): string {
    const node = this.inspection.read(target), names: string[] = [];
    for (let owner: Item | undefined = node; owner; owner = this.inspection.parent(owner.id)) {
      if ('name' in owner) names.unshift(owner.name);
    }
    const label = markdownText(names.join('.'));
    return this.page.has(this.current.id(target))
      ? this.link(target, from).replace('[' + markdownText(this.label(node)) + ']', '[' + label + ']') : label;
  }
  private references(node: Item, path: string): string[] {
    const references: string[] = [];
    const visit = (node: Item): void => {
      if (node.kind === 'reference' && node.resolution.status === 'bound') references.push(this.link(node.resolution.target, path));
      else for (const child of this.inspection.children(node.id)) visit(child);
    };
    visit(node); return [...new Set(references)];
  }
  private calls(node: Item, path: string): string {
    const calls: string[] = [];
    const visit = (node: Item): void => {
      if (node.kind === 'call-expression') {
        const selected = this.current.specification.call(node.id);
        if (selected.value) calls.push('Calls: ' + inline(language(node)) + ' — ' + this.link(selected.value, path) + '\n\n');
      }
      for (const child of this.inspection.children(node.id)) {
        if (child.id !== node.id && this.records.some(record => this.current.node(record.id) === child.id)) continue;
        visit(child);
      }
    };
    visit(node); return calls.join('');
  }
  private inferred(type: TypeId): string {
    const shape = this.current.specification.types.describe(type);
    switch (shape.kind) {
      case 'builtin': case 'declared': case 'alias': return this.label(this.inspection.read(shape.declaration)) + (shape.arguments.length ? '<' + shape.arguments.map(type => this.inferred(type)).join(', ') + '>' : '');
      case 'parameter': return this.label(this.inspection.read(shape.declaration));
      case 'optional': return this.inferred(shape.inner) + '?';
      case 'tuple': return '[' + shape.elements.map(type => this.inferred(type)).join(', ') + ']';
      case 'union': return shape.alternatives.map(type => this.inferred(type)).join(' | ');
      case 'literal': return language(this.inspection.read(shape.expression));
    }
  }
  private typeText(node: Item, path: string): string {
    if (node.kind === 'named-type') {
      const selected = node.reference.resolution;
      const spelling = node.reference.segments.join('.');
      const name = selected.status === 'bound' ? this.link(selected.target, path).replace('[' + markdownText(this.label(this.inspection.read(selected.target))) + ']', '[' + markdownText(spelling) + ']') : markdownText(spelling);
      return name + (node.arguments.length ? '\\<' + node.arguments.map(argument => this.typeText(argument, path)).join(', ') + '\\>' : '');
    }
    if (node.kind === 'optional-type') return this.typeText(node.inner, path) + '?';
    if (node.kind === 'grouped-type') return '(' + this.typeText(node.inner, path) + ')';
    if (node.kind === 'union-type') return node.alternatives.map(part => this.typeText(part, path)).join(' | ');
    if (node.kind === 'tuple-type') return '\\[' + node.elements.map(part => this.typeText(part, path)).join(', ') + '\\]';
    return inline(language(node));
  }
  private fragment(id: string, node: Item<'field' | 'parameter' | 'type-parameter' | 'participant'>, path: string): string {
    const record = this.records.find(record => record.id === id), owner = record?.address.owner ? this.items.get(record.address.owner) : undefined;
    const code = node.kind === 'field' && node.name === 'code' && owner?.kind === 'record-type-declaration' && owner.error
      ? this.current.specification.types.error(this.current.specification.types.declaredType(owner.id)) : undefined;
    const literalCodes = (type: Item): boolean => type.kind === 'literal-type' || type.kind === 'grouped-type' && literalCodes(type.inner)
      || type.kind === 'union-type' && type.alternatives.every(literalCodes);
    if (code && code.status !== 'known') throw new UnsupportedLanguage(owner!);
    return sectionStart(id).replace('expec-section:', 'expec-fragment:') + '\n\n<a id="' + anchor(id) + '"></a>\n\n'
      + '**' + markdownText(node.name) + '**' + ('declaredType' in node ? code && literalCodes(node.declaredType) ? '' : ': ' + this.typeText(node.declaredType, path) : ' — Type parameter') + '\n\n'
      + (code?.status === 'known' ? 'Codes: ' + code.value.codes.map(markdownText).join(', ') + '\n\n' : '')
      + ('defaultValue' in node && node.defaultValue ? 'Default: ' + inline(language(node.defaultValue)) + '\n\n'
        + (this.references(node.defaultValue, path).length ? 'Default references: ' + this.references(node.defaultValue, path).join(', ') + '\n\n' : '') : '')
      + this.calls(node, path) + sectionEnd(id) + '\n\n';
  }
  private section(id: string, depth: number, subjects: string[]): string {
    const node = this.items.get(id)!, path = this.page.get(id)!.path;
    subjects.push(id);
    if (node.kind === 'field' || node.kind === 'parameter' || node.kind === 'type-parameter' || node.kind === 'participant') return this.fragment(id, node, path);
    let text = sectionStart(id) + '\n\n' + '#'.repeat(Math.min(depth, 6)) + ' ' + markdownText(this.label(node)) + '\n\n<a id="' + anchor(id) + '"></a>\n\n';
    const callable = ['function', 'capability', 'setup', 'action', 'observation', 'check'].includes(node.kind);
    const declaration = language(node);
    text += fence(callable && (node.kind === 'function' || node.kind === 'capability') || node.kind === 'record-type-declaration'
      ? declaration.split('\n')[0]!.replace(/ \{(?:\})?$/, '') : declaration);
    if (node.kind === 'examples' && node.subject?.resolution.status === 'bound') text += 'Examples for: ' + this.link(node.subject.resolution.target, path) + '\n\n';
    const links = (label: string, nodes: readonly Item[]): string => {
      const values = [...new Set(nodes.flatMap(node => this.references(node, path)))];
      return values.length ? label + ': ' + values.join(', ') + '\n\n' : '';
    };
    if (node.kind === 'concept' || node.kind === 'class' || node.kind === 'component' || node.kind === 'interface') {
      const publicNodes = node.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []);
      if (publicNodes.length) text += 'Public capabilities: ' + publicNodes.map(target => this.link(target, path)).join(', ') + '\n\n';
      const internal = node.members.flatMap(member => member.kind === 'local' ? [member.declaration]
        : (member.kind === 'capability' || member.kind === 'function') && !publicNodes.includes(member.id) ? [member] : []);
      if (internal.length) text += 'Internal declarations: ' + internal.map(member => this.link(member.id, path)).join(', ') + '\n\n';
      text += links('Depends on', node.members.filter(member => member.kind === 'depends-on'));
      const packages = node.members.filter(member => member.kind === 'requires-package');
      if (packages.length) text += 'Packages: ' + packages.map(member => markdownText(member.locator.value + ' — ' + (member.phase ?? 'runtime'))).join(', ') + '\n\n';
    }
    if (node.kind === 'function' || node.kind === 'capability' || node.kind === 'setup' || node.kind === 'action' || node.kind === 'observation' || node.kind === 'check') {
      const signature = this.current.specification.types.callable(node.id), result = signature.result;
      if (node.kind !== 'function' && node.kind !== 'capability' && node.body.kind === 'absent') text += 'Implementation required.\n\n';
      text += 'Returns: ' + (result.status === 'known' && result.value.kind === 'none' ? 'Nothing (no value)'
        : node.returnType ? this.typeText(node.returnType, path) : 'Result unspecified') + '\n\n';
      text += node.failures.length ? 'May fail with: ' + node.failures.map(failure => {
        const target = failure.kind === 'named-type' && failure.reference.resolution.status === 'bound' ? failure.reference.resolution.target : undefined;
        return target ? this.link(target, path).replace('[' + markdownText(this.label(this.inspection.read(target))) + ']', '[' + markdownText(language(failure)) + ']') : inline(language(failure));
      }).join(', ') + '\n\n' : 'No domain failures declared\n\n';
      if (node.body.kind === 'available' && node.body.content.kind === 'contract-body') {
        for (const clause of node.body.content.members) if (clause.kind === 'promises') text += '- ' + markdownText(clause.text) + '\n';
        if (node.body.content.members.some(clause => clause.kind === 'promises')) text += '\n';
        const targets = this.current.specification.calls(node.id);
        if (targets.length) text += 'Calls: ' + targets.map(target => this.callLink(target, path)).join(', ') + '\n\n';
        const conditions = node.body.content.members.filter(clause => clause.kind === 'requires' || clause.kind === 'ensures');
        if (conditions.length) text += fence(conditions.map(language).join('\n'));
      }
    }
    if (node.kind === 'record-type-declaration' && node.error) {
      const error = this.current.specification.types.error(this.current.specification.types.declaredType(node.id));
      if (error.status !== 'known') throw new UnsupportedLanguage(node);
      text += 'Error type\n\n';
    }
    if (node.kind === 'opaque-type-declaration') text += 'Structure unavailable\n\n';
    if (node.kind === 'fixture') text += links('Type', [node.declaredType]) + 'Reusable data — not materialized\n\n' + links('Data references', [node.value]);
    if (node.kind === 'alias-type-declaration') text += links('Alias of', [node.targetType]);
    if (node.kind === 'scenario' || node.kind === 'example') {

      const content = node.kind === 'example' ? [node.expected] : node.steps.map(step => step.content);
      for (const expectation of content) if (expectation.kind === 'prose-expectation') text += 'Prose expectation: ' + markdownText(expectation.text.value) + '\n\n';
      if (node.kind === 'scenario') {
        const captures = node.steps.flatMap(step => { const capture = this.current.specification.step(step.id).value?.capture;
          return capture ? [language(this.inspection.read(capture.name)) + ': ' + this.inferred(capture.type)] : []; });
        if (captures.length) text += 'Captures: ' + captures.map(markdownText).join(', ') + '\n\n';
      }
    }
    if (node.kind === 'interaction') {
      text += 'Declared communication — not an observed execution.\n\nMessages:\n\n';
      for (const message of node.members.filter(member => member.kind === 'message')) {
        const facts = this.current.specification.message(message.id).value;
        if (!facts) throw new UnsupportedLanguage(message);
        text += '- ' + inline(language(message).slice('message '.length) + (message.capture && facts.reply ? ': ' + this.inferred(facts.reply) : '')) + '\n';
        text += '  \n  Operation: ' + this.link(facts.operation, path) + '\n';
      }
      text += '\n';
    }
    text += this.calls(node, path);
    if ('parameters' in node && node.parameters.length) text += '**Inputs**\n\n';
    for (const child of this.children.get(id) ?? []) text += this.section(child, depth + 1, subjects);
    return text + sectionEnd(id) + '\n\n';
  }
}
function inline(text: string): string {
  const delimiter = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return delimiter + ' ' + text.replace(/\r?\n/g, ' ') + ' ' + delimiter;
}

/** Home is page navigation, independent of any semantic declaration. */
export function renderMarkdownHome(directory: string, sourcePages: readonly { path: string }[]): MarkdownPage {
  const sources = [...sourcePages].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const text = pageStart({ outputId: 'markdown', kind: 'home', key: 'Home' }) + '\n\n# Home\n\n'
    + navigationStart + '\n\n' + sources.map(source => '- [' + markdownText(source.path.slice((directory + '/pages/').length).replace(/\.md$/, '')) + ']('
      + posix.relative(directory, source.path).split('/').map(encodeURIComponent).join('/') + ')').join('\n')
    + '\n\n' + navigationEnd + '\n\n' + scope + '\n\n' + pageEnd('Home') + '\n\n';
  return { kind: 'home', key: 'Home', path: directory + '/Home.md', region: Buffer.from(text), subjects: [] };
}
