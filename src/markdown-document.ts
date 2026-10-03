import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { TypeId } from './types.js';
import { anchor } from './output-projection.js';
import { language, UnsupportedMarkdown } from './markdown-language.js';

export const emptyNotes = '## Your notes\n\nEdit this area for your own notes. Content above it is generated from .expec.\n\n';
export interface MarkdownPage { id: string; path: string; region: Uint8Array; subjects: string[] }
export const sectionStart = (id: string): string => '<!-- expec-section:' + Buffer.from(JSON.stringify({ outputId: 'markdown', specId: id })).toString('hex') + ' -->';
export const sectionEnd = (id: string): string => '<!-- expec-end:' + Buffer.from(id).toString('hex') + ' -->';
export const markdownText = (text: string): string => text.replace(/[\\`*_[\]<>#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
const fence = (text: string): string => {
  const delimiter = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return delimiter + 'expec\n' + text + '\n' + delimiter + '\n\n';
};
const scope = 'Statically checked specification. Runtime behavior is not verified by this document.';
const contractStatus = 'Declared contract — project implementation not assessed.';
const exampleStatus = 'Example — statically checked; not executed.';
const proseStatus = 'Authored intent — no executable assertion supplied for this text.';

/** Groups the existing inspected subjects into reader pages, retaining their persistent identities. */
export class MarkdownDocumentation {
  private readonly inspection;
  private readonly records;
  private readonly items = new Map<string, Item>();
  private readonly children = new Map<string, string[]>();
  private readonly page = new Map<string, { id: string; path: string }>();
  private readonly attached = new Map<string, string[]>();
  constructor(private readonly current: IdentifiedSpecification, private readonly directory: string) {
    this.inspection = current.specification.inspection;
    this.records = current.baseline.elements.filter(record => record.origin.kind === 'source');
    for (const record of this.records) {
      this.items.set(record.id, this.inspection.read(current.node(record.id)));
      if (record.address.owner) this.children.set(record.address.owner, [...this.children.get(record.address.owner) ?? [], record.id]);
    }
    const roots = this.records.filter(record => !record.address.owner);
    for (const record of roots) {
      const node = this.items.get(record.id)!;
      if (node.kind === 'examples' && node.subject?.resolution.status === 'bound') {
        const target = this.inspection.read(node.subject.resolution.target);
        if (target.origin.kind === 'source') {
          let owner = current.id(target.id), ancestor = this.records.find(record => record.id === owner)!;
          while (ancestor.address.owner) { owner = ancestor.address.owner; ancestor = this.records.find(record => record.id === owner)!; }
          this.attached.set(owner, [...this.attached.get(owner) ?? [], record.id]); continue;
        }
      }
      const filename = node.kind === 'examples' ? 'examples/' + createHash('sha256').update(record.id).digest('hex')
        : node.kind === 'interaction' ? 'interactions/' + node.title.value : 'name' in node ? node.name : undefined;
      if (filename === undefined) throw new UnsupportedMarkdown(node);
      this.page.set(record.id, { id: record.id, path: directory + '/' + filename + '.md' });
    }
    const assign = (id: string, page: { id: string; path: string }): void => {
      this.page.set(id, page);
      for (const child of [...this.children.get(id) ?? [], ...this.attached.get(id) ?? []]) assign(child, page);
    };
    for (const [id, page] of [...this.page]) assign(id, page);
  }
  render(): MarkdownPage[] {
    return [...this.page].filter(([id, page]) => id === page.id).map(([id, page]) => {
      const subjects: string[] = [];
      return { id, path: page.path, region: Buffer.from(this.section(id, 1, subjects)), subjects };
    });
  }
  private label(node: Item): string { return 'name' in node ? node.name : 'title' in node ? node.title.value : node.kind === 'examples' ? 'Examples' : node.kind === 'construction' ? 'Construction' : node.kind; }
  private link(target: NodeId, from: string): string {
    const node = this.inspection.read(target), label = markdownText(this.label(node));
    if (node.origin.kind === 'builtin') return label;
    const page = this.page.get(this.current.id(target));
    if (!page) return label + ' — ' + markdownText(node.origin.module) + (node.origin.kind === 'external' ? ' — External implementation not assessed' : '');
    const url = posix.relative(posix.dirname(from), page.path).split('/').map(encodeURIComponent).join('/') + '#' + anchor(this.current.id(target));
    return '[' + label + '](' + url + ')';
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
  private fragment(id: string, node: Item<'field' | 'parameter' | 'type-parameter' | 'participant'>, path: string): string {
    const label = node.kind === 'type-parameter' ? 'Type parameter' : node.kind[0]!.toUpperCase() + node.kind.slice(1);
    const source = node.origin.kind === 'source' ? node.origin.module + ':' + node.origin.range.start.line + ':' + node.origin.range.start.column : '';
    const references = 'declaredType' in node ? this.references(node.declaredType, path) : [];
    return sectionStart(id).replace('expec-section:', 'expec-fragment:') + '\n\n<a id="' + anchor(id) + '"></a>\n\n'
      + label + ': ' + inline(language(node)) + ' — Source: ' + markdownText(source) + '\n\n'
      + (references.length ? (node.kind === 'parameter' ? 'Input' : 'Type') + ': ' + references.join(', ') + '\n\n' : '')
      + ('defaultValue' in node && node.defaultValue ? 'Authored default — not evaluated\n\n' + (this.references(node.defaultValue, path).length ? 'Default references: ' + this.references(node.defaultValue, path).join(', ') + '\n\n' : '') : '')
      + this.calls(node, path) + sectionEnd(id) + '\n\n';
  }
  private section(id: string, depth: number, subjects: string[]): string {
    const node = this.items.get(id)!, path = this.page.get(id)!.path;
    subjects.push(id);
    if (node.kind === 'field' || node.kind === 'parameter' || node.kind === 'type-parameter' || node.kind === 'participant') return this.fragment(id, node, path);
    let text = sectionStart(id) + '\n\n' + '#'.repeat(Math.min(depth, 6)) + ' ' + markdownText(this.label(node)) + '\n\n<a id="' + anchor(id) + '"></a>\n\n';
    if (depth === 1) text += scope + '\n\n';
    text += fence(language(node));
    if (node.origin.kind === 'source') text += 'Source: ' + markdownText(node.origin.module + ':' + node.origin.range.start.line + ':' + node.origin.range.start.column) + '\n\n';
    const links = (label: string, nodes: readonly Item[]): string => {
      const values = [...new Set(nodes.flatMap(node => this.references(node, path)))];
      return values.length ? label + ': ' + values.join(', ') + '\n\n' : '';
    };
    if (node.kind === 'concept' || node.kind === 'class' || node.kind === 'component' || node.kind === 'interface') {
      const publicNodes = node.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []);
      text += 'Public capabilities: ' + publicNodes.map(target => this.link(target, path)).join(', ') + '\n\n';
      const internal = node.members.flatMap(member => member.kind === 'local' ? [member.declaration]
        : (member.kind === 'capability' || member.kind === 'function') && !publicNodes.includes(member.id) ? [member] : []);
      text += 'Internal declarations: ' + internal.map(member => this.link(member.id, path)).join(', ') + '\n\n';
      text += links('Depends on', node.members.filter(member => member.kind === 'depends-on'));
      const packages = node.members.filter(member => member.kind === 'requires-package');
      if (packages.length) text += 'Packages: ' + packages.map(member => markdownText(member.locator.value + ' — ' + (member.phase ?? 'runtime'))).join(', ') + '\n\n';
    }
    if (node.kind === 'function' || node.kind === 'capability' || node.kind === 'setup' || node.kind === 'action' || node.kind === 'observation' || node.kind === 'check') {
      const signature = this.current.specification.types.callable(node.id), result = signature.result;
      text += (node.kind === 'function' || node.kind === 'capability' ? contractStatus
        : node.body.kind === 'available' ? 'Authored operation body — statically checked; not executed.'
        : node.body.kind === 'absent' ? 'No authored body — implementation obligation; connected project not assessed.'
        : 'External implementation not assessed') + '\n\n';
      text += 'Result: ' + (result.status === 'known' && result.value.kind === 'none' ? 'Nothing (no value)'
        : node.returnType ? inline(language(node.returnType)) : 'Result unspecified') + '\n\n';
      text += links('Input', node.parameters.map(parameter => parameter.declaredType));
      if (node.returnType) text += links('Output', [node.returnType]);
      text += node.failures.length ? 'May fail with: ' + node.failures.map(failure => {
        const target = failure.kind === 'named-type' && failure.reference.resolution.status === 'bound' ? failure.reference.resolution.target : undefined;
        return target ? this.link(target, path).replace('[' + markdownText(this.label(this.inspection.read(target))) + ']', '[' + markdownText(language(failure)) + ']') : inline(language(failure));
      }).join(', ') + '\n\n' : 'No domain failures declared\n\n';
      if (node.body.kind === 'available' && node.body.content.kind === 'contract-body') {
        for (const clause of node.body.content.members) if (clause.kind === 'promises') text += proseStatus + '\n\n' + markdownText(clause.text) + '\n\n';
        const conditions = node.body.content.members.filter(clause => clause.kind !== 'promises');
        if (conditions.length) text += fence(conditions.map(language).join('\n'));
      }
    }
    if (node.kind === 'record-type-declaration' && node.error) {
      const error = this.current.specification.types.error(this.current.specification.types.declaredType(node.id));
      if (error.status !== 'known') throw new UnsupportedMarkdown(node);
      text += 'Error type\n\nCodes: ' + error.value.codes.map(markdownText).join(', ') + '\n\n';
    }
    if (node.kind === 'opaque-type-declaration') text += 'Structure unavailable\n\n';
    if (node.kind === 'fixture') text += links('Type', [node.declaredType]) + 'Reusable data — not materialized\n\n' + links('Data references', [node.value]);
    if (node.kind === 'alias-type-declaration') text += links('Alias of', [node.targetType]);
    if (node.kind === 'scenario' || node.kind === 'example') {
      text += exampleStatus + '\n\n';
      const content = node.kind === 'example' ? [node.expected] : node.steps.map(step => step.content);
      for (const expectation of content) if (expectation.kind === 'prose-expectation') text += proseStatus + '\n\n' + markdownText(expectation.text.value) + '\n\n';
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
        if (!facts) throw new UnsupportedMarkdown(message);
        text += '- ' + inline(language(message).slice('message '.length) + (message.capture && facts.reply ? ': ' + this.inferred(facts.reply) : '')) + '\n';
        text += '  \n  Operation: ' + this.link(facts.operation, path) + '\n';
      }
      text += '\n';
    }
    text += this.calls(node, path);
    for (const child of [...this.children.get(id) ?? [], ...this.attached.get(id) ?? []]) text += this.section(child, depth + 1, subjects);
    return text + sectionEnd(id) + '\n\n';
  }
}
function inline(text: string): string {
  const delimiter = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return delimiter + ' ' + text.replace(/\r?\n/g, ' ') + ' ' + delimiter;
}
