import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Class } from '@d2lang/d2';
import type { IdentifiedSpecification } from '../../model/specification-identity.js';
import type { DiagramPreview, DiagramPromise } from './output.js';
import type { NativeRead } from './uml-native.js';

const number = (value: string | null): number => {
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value))) throw new TypeError('Native SVG coordinate is unavailable.');
  return Number(value);
};

/** D2 validates tooltip Markdown; expose authored promises as inert text in the static SVG. */
export function plainPromiseTitles(native: NativeRead, svg: string): string {
  const marked = native.statements.filter(statement => statement.metadata?.promiseTooltip === true);
  if (!marked.length) return svg;
  const xml = new DOMParser({ onError: (_level, message) => { throw new TypeError(message); } }).parseFromString(svg, 'image/svg+xml');
  const replaced = new Set<string>();
  for (const statement of marked) {
    const tooltip = statement.children.find(child => child.key.length === 1 && child.key[0] === 'tooltip')?.value;
    const literal = tooltip && /^(`{3,})text\n([\s\S]*)\n\1$/.exec(tooltip);
    const group = Array.from(xml.getElementsByTagName('g')).find(group =>
      (group.getAttribute('class') ?? '').split(/\s+/).some(value => Buffer.from(value, 'base64').toString('utf8') === statement.key[0]));
    if (!literal || !group) throw new TypeError('Native promise tooltip does not match its rendered container.');
    if (!replaced.has(tooltip!)) {
      const icons = Array.from(xml.getElementsByTagName('g')).filter(icon => icon.getAttribute('class') === 'appendix-icon'
        && Array.from(icon.getElementsByTagName('title')).some(title => title.textContent === tooltip));
      if (!icons.length) throw new TypeError('The actual native promise tooltip is unavailable.');
      for (const icon of icons) icon.parentNode!.removeChild(icon);
      replaced.add(tooltip!);
    }
    const title = xml.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = literal[2]!;
    group.insertBefore(title, group.firstChild);
  }
  return new XMLSerializer().serializeToString(xml);
}

/** Adapts actual native class rows into inert controls on this exact rendered image. */
export function promiseAnnotations(current: IdentifiedSpecification, native: NativeRead, svg: string): DiagramPreview {
  const xml = new DOMParser({ onError: (_level, message) => { throw new TypeError(message); } }).parseFromString(svg, 'image/svg+xml');
  const root = xml.documentElement;
  if (root?.localName !== 'svg') throw new TypeError('Expected the rendered native SVG.');
  const viewport = Array.from(root.getElementsByTagName('svg')).find(node => node.getAttribute('class')?.split(/\s+/).includes('d2-svg'));
  if (!viewport) throw new TypeError('Native diagram coordinate surface is unavailable.');
  const box = viewport.getAttribute('viewBox')?.trim().split(/\s+/).map(number);
  const surface = root.getAttribute('viewBox')?.trim().split(/\s+/).map(number);
  if (!box || box.length !== 4 || !surface || surface.length !== 4 || surface[0] !== 0 || surface[1] !== 0
    || surface[2] !== box[2] || surface[3] !== box[3] || box[2]! <= 0 || box[3]! <= 0) throw new TypeError('Unsupported native SVG surface transform.');
  const annotations: DiagramPromise[] = [];
  for (const owner of native.statements.filter(statement => typeof statement.metadata?.definition === 'string')) {
    const members = owner.children.filter(member => typeof member.metadata?.member === 'string').flatMap(member => {
      const id = member.metadata!.member as string, item = current.specification.inspection.read(current.node(id));
      if ((item.kind !== 'capability' && item.kind !== 'function') || item.body.kind !== 'available') return [];
      const promises = item.body.content.members.flatMap(clause => clause.kind === 'promises' ? [clause.text] : []);
      return promises.length ? [{ member, id, item, promises }] : [];
    });
    if (!members.length) continue;
    const shape = native.compiled?.diagram.shapes.find(shape => shape.id === owner.key[0]);
    if (!shape || shape.type !== 'class') throw new TypeError('Annotated operation needs an actual native class.');
    const group = Array.from(viewport.getElementsByTagName('g')).find(group =>
      (group.getAttribute('class') ?? '').split(/\s+/).some(value => Buffer.from(value, 'base64').toString('utf8') === shape.id));
    if (!group) throw new TypeError('Rendered operation container is unavailable.');
    const rectangles = Array.from(group.getElementsByTagName('rect'));
    const boundary = rectangles.find(rect => !rect.getAttribute('class')?.includes('class_header'));
    const header = rectangles.find(rect => rect.getAttribute('class')?.includes('class_header'));
    if (!boundary || !header || (shape as typeof shape & Class).fields?.length) throw new TypeError('Unsupported native operation compartments.');
    const texts = Array.from(group.getElementsByTagName('text'));
    const rows = (shape as typeof shape & Class).methods.map(method => {
      const captions = texts.filter(text => text.textContent === method.name);
      if (captions.length !== 1) throw new TypeError('Rendered operation row is ambiguous.');
      return { name: method.name, baseline: number(captions[0]!.getAttribute('y')) };
    }).sort((left, right) => left.baseline - right.baseline);
    const left = number(boundary.getAttribute('x')), width = number(boundary.getAttribute('width'));
    const top = number(header.getAttribute('y')) + number(header.getAttribute('height'));
    const bottom = number(boundary.getAttribute('y')) + number(boundary.getAttribute('height'));
    const height = (bottom - top) / rows.length;
    for (const [index, row] of rows.entries()) if (!(row.baseline > top + index * height && row.baseline < top + (index + 1) * height)) {
      throw new TypeError('Native operation positions do not match their rendered compartments.');
    }
    for (const { member, id, item, promises } of members) {
      const caption = member.key[0]!.replace(/^[+-]/, ''), index = rows.findIndex(row => row.name === caption);
      if (index < 0) throw new TypeError('Promised operation has no actual rendered row.');
      const label = item.kind === 'function' ? String(owner.metadata!.name) : String(owner.metadata!.name) + '.' + item.name;
      annotations.push({ id, label, x: left - box[0]!, y: top + index * height - box[1]!, width, height, promises });
    }
  }
  return { width: box[2]!, height: box[3]!, promises: annotations };
}
