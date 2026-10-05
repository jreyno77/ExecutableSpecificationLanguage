import { z } from 'zod';
import { parseTree, getNodeValue, type ParseError, type Node } from 'jsonc-parser';
import { identifier } from '../../../model/identity-baseline.js';
import { hash, literal } from '../../connection/project-files.js';
import type { NativeRead } from './uml-native.js';
import type { ProjectSnapshot } from '../../connection/project-connection.js';
import { outputProblem } from './output-documents.js';

export const statePath = '.expec/outputs/756d6c.json';
export const begin = '# expec-uml-begin\n', end = '# expec-uml-end\n';
export const notes = '\n# Handwritten notes: add comments, unique root objects or explicit edges below.\n';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const subject = z.strictObject({ id: identifier, name: z.string(), kind: z.string(), owner: identifier.optional() });
const document = z.strictObject({ path: z.string().refine(literal), view: z.enum(['structure', 'interaction']), id: identifier.optional(),
  region: digest, svg: digest, rendered: digest, subjects: z.array(subject) });
const schema = z.strictObject({ format: z.literal(1), renderFormat: z.literal(1), directory: z.string().refine(literal), views: z.array(z.enum(['structure', 'interactions'])),
  context: z.string(), documents: z.array(document), deleted: z.array(identifier) });
export type DiagramState = z.infer<typeof schema>;
export function readState(snapshot: ProjectSnapshot): DiagramState | undefined {
  const file = snapshot.files.find(file => file.path === statePath); if (!file) return;
  const errors: ParseError[] = [], tree = parseTree(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), errors, { disallowComments: true, allowTrailingComma: false });
  const distinct = (node: Node): boolean => node.type !== 'object' || new Set(node.children?.map(property => property.children![0]!.value)).size === node.children?.length;
  const valid = (node: Node): boolean => distinct(node) && (node.children ?? []).every(valid);
  if (!tree || errors.length || !valid(tree)) throw new Error('Malformed output state.');
  const state = schema.parse(getNodeValue(tree));
  if (new Set(state.documents.map(document => document.path)).size !== state.documents.length || new Set(state.views).size !== state.views.length
    || new Set(state.deleted).size !== state.deleted.length || state.documents.some(document => new Set(document.subjects.map(subject => subject.id)).size !== document.subjects.length)) throw new Error('Duplicate output state.');
  return state;
}
export function region(text: string): { start: number; finish: number; content: string; prefix: string; suffix: string } {
  const starts = [...text.matchAll(/^# expec-uml-begin\n/gm)], finishes = [...text.matchAll(/^# expec-uml-end\n/gm)];
  if (starts.length !== 1 || finishes.length !== 1 || starts[0]!.index >= finishes[0]!.index) throw new Error('Missing, duplicate or overlapping generated region.');
  const start = starts[0]!.index, finish = finishes[0]!.index + end.length;
  return { start, finish, content: text.slice(start, finish), prefix: text.slice(0, start), suffix: text.slice(finish) };
}
export function handwritten(document: NativeRead): ReturnType<typeof outputProblem>[] {
  const span = region(document.text), owned = document.statements.filter(node => node.range.start >= span.start && node.range.end <= span.finish);
  const keys = new Set(owned.filter(node => !node.edges.length).map(node => node.key[0]));
  const edgeKeys = new Set(owned.flatMap(node => node.edges.map(edge => edge.from.join('.') + '|' + edge.to.join('.'))));
  const globals = new Set(['shape', 'label', 'direction', 'vars', 'style', 'width', 'height', 'near', 'classes']);
  return document.statements.filter(node => node.range.start < span.start || node.range.start >= span.finish).flatMap(node => {
    const note = node.key.length === 2 && node.key[1] === 'note' && keys.has(node.key[0]) && owned.some(node => node.key[0] === 'shape' && node.value === 'sequence_diagram');
    return (!node.edges.length && !note && (keys.has(node.key[0]) || globals.has(node.key[0]!))
      || node.edges.some(edge => edgeKeys.has(edge.from.join('.') + '|' + edge.to.join('.'))))
      ? [outputProblem('handwritten-diagram-conflict', document.path, 'An outside assignment changes generated content or configuration.')] : [];
  });
}
export function provenance(path: string, text: string, svg: string): string {
  const start = svg.indexOf('<svg'), at = svg.indexOf('>', start);
  if (start < 0 || at < 0) throw new Error('Native renderer returned no SVG.');
  const data = Buffer.from(JSON.stringify({ format: 1, outputId: 'uml', source: path, digest: hash(Buffer.from(text)), engine: '@d2lang/d2@0.1.34',
    renderFormat: 1, layout: 'dagre', theme: 0, sketch: false, animation: false, fonts: 'embedded-default', salt: hash(Buffer.from('uml/' + path)) })).toString('base64url');
  return svg.slice(0, at + 1) + '<metadata id="expec-diagram">' + data + '</metadata>' + svg.slice(at + 1);
}
export function renderedSource(bytes: Uint8Array): { source: string; digest: string } | undefined {
  const matches = [...Buffer.from(bytes).toString().matchAll(/<metadata id="expec-diagram">([A-Za-z0-9_-]+)<\/metadata>/g)];
  if (matches.length !== 1) return;
  try { const value: unknown = JSON.parse(Buffer.from(matches[0]![1]!, 'base64url').toString());
    if (value && typeof value === 'object' && 'source' in value && typeof value.source === 'string' && 'digest' in value && typeof value.digest === 'string') return { source: value.source, digest: value.digest };
  } catch { /* Untrusted native metadata is only a discovery hint. */ }
}
