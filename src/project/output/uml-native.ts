import { D2, type CompileResponse } from '@d2lang/d2';
import type { Diagnostic } from '../../compiler/checking.js';
import { identifier, jsonData } from '../../model/identity-baseline.js';
import { hash } from '../connection/project-files.js';
import { outputProblem } from './output-documents.js';

export interface NativeRange { start: number; end: number; line: number; column: number }
export interface NativeEdge { from: string[]; to: string[]; range: NativeRange; fromRange: NativeRange; toRange: NativeRange; left: boolean; right: boolean }
export interface NativeStatement { key: string[]; value: string; range: NativeRange; keyRange: NativeRange; children: NativeStatement[]; edges: NativeEdge[]; metadata?: Record<string, unknown>; metadataStart?: number }
export interface NativeRead { path: string; text: string; statements: NativeStatement[]; limitations: string[]; problems: Diagnostic[]; interaction?: string; compiled?: CompileResponse }
export class NativeDiagrams {
  private engine?: D2;
  async read(path: string, files: Record<string, string>): Promise<NativeRead> {
    const result: NativeRead = { path, text: files[path]!, statements: [], limitations: [], problems: [] };
    try {
      this.engine ??= new D2();
      result.compiled = await this.engine.compile({ fs: files, inputPath: path, options: { layout: 'dagre', themeID: 0, sketch: false } });
      if (hasNative(result.compiled.graph.ast, ['import'])) result.limitations.push(path + ': imports');
      result.statements = this.statements(object(result.compiled.graph.ast), result);
      const graph = object(result.compiled.graph), root = object(graph.root);
      if (result.interaction && object(object(root.attributes).shape).value !== 'sequence_diagram') throw new Error('Interaction metadata requires an actual root sequence diagram.');
      const attributes = new Set(['shape', 'label', 'near', 'style', 'width', 'height', 'direction', 'tooltip', 'icon', 'link']);
      const objects = Array.isArray(graph.objects) ? graph.objects.map(object) : [];
      for (const node of result.statements) {
        const target = objects.find(value => value.id_val === node.key[0] && Array.isArray(value.references) && value.references.some(reference => {
          const key = object(object(reference).key);
          return segments(key).length === 1 && range(key.range, result).start === node.keyRange.start;
        }));
        const shape = object(object(target?.attributes).shape).value;
        if (node.children.some(child => child.metadata?.member) && shape !== 'class') throw new Error('Member metadata requires an actual immediate root class compartment.');
        if (!attributes.has(node.key[0]!) && node.children.some(child => child.edges.length || shape !== 'class' && !attributes.has(child.key[0]!))) result.limitations.push(path + ': nested native scope');
      }
    } catch (error) { result.problems.push(outputProblem('invalid-output-document', path, String(error))); result.limitations.push(path + ': native syntax or provenance could not be read'); }
    return result;
  }
  async render(document: NativeRead): Promise<string> {
    if (!document.compiled || document.limitations.length || document.problems.length || !this.engine) throw new Error('Render requires a successfully read supported diagram.');
    const svg = await this.engine.render(document.compiled.diagram, { ...document.compiled.renderOptions, salt: hash(Buffer.from('uml/' + document.path)), animateInterval: 0 });
    if (!svg.includes('<svg')) throw new Error('The native renderer returned no SVG document.');
    return svg;
  }
  async dispose(): Promise<void> { if (this.engine) await this.engine.dispose(); }
  private statements(map: Record<string, unknown>, result: NativeRead, depth = 0): NativeStatement[] {
    if (!Array.isArray(map.nodes)) throw new Error('Native map nodes are unavailable.');
    const statements: NativeStatement[] = [];
    let metadata: Record<string, unknown> | undefined, metadataStart: number | undefined;
    for (const node of map.nodes) {
      const record = object(node), comment = object(record.comment);
      if (typeof comment.value === 'string') for (const line of comment.value.split('\n')) {
        if (!line.startsWith('expec-uml: ')) continue;
        const value: unknown = JSON.parse(Buffer.from(line.slice(11), 'base64url').toString('utf8')), data = object(value);
        if (!jsonData(value) || data.format !== 1 || typeof data.outputId !== 'string') throw new Error('Malformed diagram identity record.');
        if (data.outputId !== 'uml') continue;
        if (['definition', 'reference', 'member', 'edge', 'message', 'interaction'].filter(key => key in data).length > 1
          || ['definition', 'reference', 'member', 'interaction'].some(key => key in data && !identifier.safeParse(data[key]).success)) throw new Error('Contradictory or invalid native identity record.');
        if (data.interaction) { if (typeof data.interaction !== 'string' || result.interaction) throw new Error('Malformed interaction identity.'); result.interaction = data.interaction; }
        if (data.definition || data.reference || data.member || data.edge || data.message) {
          if (metadata) throw new Error('Two identity records claim one native statement.');
          metadata = data; metadataStart = result.text.indexOf('# ' + line, range(comment.range, result).start);
          if (metadataStart < 0 || metadataStart > range(comment.range, result).end) throw new Error('Metadata range disagrees with original source.');
        }
      }
      if (!record.map_key) { if (!record.comment) result.limitations.push(result.path + ': unsupported native statement'); continue; }
      const key = object(record.map_key), path = object(key.key), values = object(key.value);
      const edges = Array.isArray(key.edges) ? key.edges.map(value => {
        const edge = object(value), src = object(edge.src), dst = object(edge.dst);
        const from = segments(src), to = segments(dst);
        if (glob(src) || glob(dst)) result.limitations.push(result.path + ': globs');
        if (from.length !== 1 || to.length !== 1) result.limitations.push(result.path + ': nested-endpoint');
        return { from, to, range: range(edge.range, result), fromRange: range(src.range, result), toRange: range(dst.range, result), left: !!edge.src_arrow, right: !!edge.dst_arrow };
      }) : [];
      const keys = segments(path), statement: NativeStatement = { key: keys, value: scalar(key.primary) || scalar(key.value), range: range(key.range, result),
        keyRange: range(path.range ?? key.range, result), children: [], edges, ...(metadata ? { metadata, metadataStart: metadataStart! } : {}) };
      if (metadata && ((metadata.edge || metadata.message) ? !edges.length : edges.length || keys.length !== 1)
        || metadata?.member && depth !== 1) throw new Error('Identity metadata does not match the following native statement.');
      if (values.map) statement.children = this.statements(object(values.map), result, depth + 1);
      if (glob(path)) result.limitations.push(result.path + ': globs');
      if (['layers', 'scenarios', 'steps', 'vars'].includes(keys[0] ?? '')) result.limitations.push(result.path + ': boards or substitution');
      if (keys.some(key => ['icon', 'link'].includes(key)) || keys[0] === 'shape' && statement.value === 'image') result.limitations.push(result.path + ': external-asset');
      if (hasNative(record, ['import'])) result.limitations.push(result.path + ': imports');
      if (hasNative(record, ['substitution', 'interpolation'])) result.limitations.push(result.path + ': substitution');
      if (depth > 1 && values.map || keys.length > 1 && keys.at(-1) !== 'note') result.limitations.push(result.path + ': nested native scope');
      statements.push(statement); metadata = undefined; metadataStart = undefined;
    }
    if (metadata) throw new Error('Diagram identity record has no following native statement.');
    return statements;
  }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function scalar(value: unknown): string {
  const data = object(value);
  for (const kind of ['unquoted_string', 'double_quoted_string', 'single_quoted_string', 'block_string']) {
    const text = object(data[kind]);
    if (typeof text.value === 'string') return text.value;
    if (Array.isArray(text.value)) return text.value.map(part => object(part).string ?? '').join('');
  }
  return '';
}
function segments(path: Record<string, unknown>): string[] { return Array.isArray(path.path) ? path.path.map(scalar) : []; }
function glob(path: Record<string, unknown>): boolean {
  return Array.isArray(path.path) && path.path.some(part => {
    const pattern = object(object(part).unquoted_string).pattern;
    return Array.isArray(pattern) && pattern.length > 0;
  });
}
function hasNative(value: unknown, fields: string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => fields.includes(key) && child !== null || hasNative(child, fields));
}
function range(value: unknown, document: Pick<NativeRead, 'path' | 'text'>): NativeRange {
  const match = typeof value === 'string' && /^(.*),(\d+):(\d+):(\d+)-(\d+):(\d+):(\d+)$/.exec(value);
  if (!match || match[1] !== document.path) throw new Error('Native range is absent or belongs to another file.');
  const start = Number(match[4]), end = Number(match[7]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > document.text.length) throw new Error('Native range is outside original input.');
  return { start, end, line: Number(match[2]) + 1, column: Number(match[3]) };
}
