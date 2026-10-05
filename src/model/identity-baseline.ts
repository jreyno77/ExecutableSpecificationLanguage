import { z } from 'zod';
import { parseTree, getNodeValue, type ParseError, type Node } from 'jsonc-parser';
import type { Check, Diagnostic } from '../compiler/checking.js';
import type { SourceDocument } from '../language/source.js';

export const eligibleKinds = ['concept', 'component', 'class', 'interface', 'record-type-declaration',
  'alias-type-declaration', 'opaque-type-declaration', 'type-parameter', 'capability', 'function', 'setup',
  'action', 'observation', 'check', 'field', 'parameter', 'fixture', 'participant', 'construction', 'examples',
  'example', 'scenario', 'interaction'] as const;
export type SpecIdentifier = string;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type ReadonlyData<T> = JsonValue extends T ? T : T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;
const text = z.string().refine(value => !!value.trim(), 'Provide nonblank text.');
export const identifier = text.max(256);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const position = z.strictObject({ offset: integer, line: integer.min(1), column: integer });
const origin = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('source'), module: text, node: z.strictObject({ sourceId: text, ordinal: integer }),
    range: z.strictObject({ sourceId: text, start: position, end: position }) }),
  z.strictObject({ kind: z.literal('external'), module: text, path: z.array(z.union([z.string(), integer])) }),
]);
export const locatorSchema = z.strictObject({ outputId: text, format: text, value: z.custom<JsonValue>(jsonData, 'Provide finite JSON data.') });
const association = z.strictObject({ specId: identifier, locator: locatorSchema });
const record = z.strictObject({ id: identifier,
  address: z.strictObject({ module: text, owner: identifier.nullable(), kind: z.enum(eligibleKinds), name: z.string().nullable() }),
  occurrence: integer, capture: digest, structure: digest, origin, references: z.array(identifier) });
const baselineSchema = z.strictObject({ format: z.literal(1), projection: z.literal('expec-structure-1'), entry: text,
  modules: z.array(text), context: digest, elements: z.array(record), retired: z.array(identifier), artifacts: z.array(association) });
export type ArtifactLocator = ReadonlyData<z.infer<typeof locatorSchema>>;
export type ArtifactAssociation = ReadonlyData<z.infer<typeof association>>;
export type IdentityRecord = ReadonlyData<z.infer<typeof record>>;
export type IdentityBaseline = ReadonlyData<z.infer<typeof baselineSchema>>;

export function failure<T = never>(code: string, message: string, path: readonly (string | number)[] = []): Check<T> {
  return { problems: [{ code, message, at: { kind: 'dependency', path }, related: [] }], deferred: [] };
}
export function success<T>(value: T): Check<T> { return { value, problems: [], deferred: [] }; }
export function jsonData(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value) || !Array.isArray(value)
    && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Object.getOwnPropertySymbols(value).length === 0
    && (Array.isArray(value) ? [...value] : Object.values(value)).every(child => jsonData(child, ancestors));
  ancestors.delete(value);
  return valid;
}
export function canonical(value: unknown, indent = 0, depth = 0): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Array.isArray(value) ? value.map(child => canonical(child, indent, depth + 1))
    : Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + (indent ? ': ' : ':') + canonical((value as Record<string, unknown>)[key], indent, depth + 1));
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return !entries.length ? open + close : indent
    ? open + '\n' + entries.map(entry => ' '.repeat((depth + 1) * indent) + entry).join(',\n') + '\n' + ' '.repeat(depth * indent) + close
    : open + entries.join(',') + close;
}
export function captured<T>(value: T): T {
  const freeze = (data: unknown): void => {
    if (data && typeof data === 'object') { Object.values(data).forEach(freeze); Object.freeze(data); }
  };
  const copy = JSON.parse(canonical(value)) as T;
  freeze(copy);
  return copy;
}
export function readBaseline(source: SourceDocument): Check<IdentityBaseline> {
  const errors: ParseError[] = [], tree = parseTree(source.text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) return failure('identity-baseline', 'Provide complete JSON for ' + source.sourceId, [source.sourceId]);
  const duplicate = (node: Node): string | undefined => {
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children![0]!.value as string;
        if (keys.has(key)) return key;
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) { const key = duplicate(child); if (key !== undefined) return key; }
    return undefined;
  };
  const key = duplicate(tree);
  return key === undefined ? validateBaseline(getNodeValue(tree))
    : failure('identity-baseline', 'Duplicate JSON property ' + key, [source.sourceId, key]);
}
export function validateBaseline(input: unknown): Check<IdentityBaseline> {
  if (!jsonData(input)) return failure('identity-baseline', 'A baseline must contain finite, acyclic JSON data.');
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const data = input as Record<string, unknown>;
    if (data.format !== undefined && data.format !== 1 || data.projection !== undefined && data.projection !== 'expec-structure-1') {
      return failure('identity-format', 'Unsupported identity format/projection: ' + String(data.format) + '/' + String(data.projection));
    }
  }
  const parsed = baselineSchema.safeParse(input);
  if (!parsed.success) return { problems: parsed.error.issues.map(issue => ({
    code: 'identity-baseline', message: issue.message, at: { kind: 'dependency', path: issue.path as (string | number)[] }, related: [],
  })), deferred: [] };
  const data = parsed.data, problems: Diagnostic[] = [];
  const issue = (message: string, path: (string | number)[] = []): void => { problems.push(...failure('identity-baseline', message, path).problems); };
  const unique = (values: readonly string[], name: string): void => { if (new Set(values).size !== values.length) issue('Duplicate ' + name); };
  unique(data.modules, 'module'); unique(data.elements.map(element => element.id), 'identifier'); unique(data.retired, 'retired identifier');
  const records = new Map(data.elements.map(element => [element.id, element])), retired = new Set(data.retired);
  if (!data.modules.includes(data.entry)) issue('Entry module is absent.');
  const groups = new Map<string, number[]>();
  for (const [index, element] of data.elements.entries()) {
    const at = ['elements', index], address = element.address;
    if (retired.has(element.id)) issue('Active identifier is retired: ' + element.id, at);
    if (!data.modules.includes(address.module) || element.origin.module !== address.module) issue('Element module does not match its provenance.', at);
    if ((address.kind === 'construction' || address.kind === 'examples') !== (address.name === null)) issue('Name does not match the eligible kind.', at);
    const group = canonical(address), occurrences = groups.get(group) ?? [];
    occurrences.push(element.occurrence); groups.set(group, occurrences);
    const visited = new Set([element.id]);
    for (let owner = address.owner; owner !== null; owner = records.get(owner)!.address.owner) {
      if (!records.has(owner) || visited.has(owner)) { issue('Missing or cyclic owner for ' + element.id, at); break; }
      visited.add(owner);
    }
    if (element.references.some(id => !records.has(id)) || canonical(element.references) !== canonical([...new Set(element.references)].sort())) {
      issue('References must be sorted, distinct active identifiers.', at);
    }
    if (element.origin.kind === 'source') {
      const { node, range } = element.origin;
      if (node.sourceId !== range.sourceId || range.end.offset < range.start.offset
        || range.end.line < range.start.line || range.end.line === range.start.line && range.end.column < range.start.column) {
        issue('Source range is inconsistent.', at);
      }
    }
  }
  for (const occurrences of groups.values()) if (canonical([...occurrences].sort((a, b) => a - b)) !== canonical(occurrences.map((_, index) => index))) {
    issue('Group occurrences must be distinct and contiguous.');
  }
  const links = new Set<string>();
  for (const [index, link] of data.artifacts.entries()) {
    const key = canonical(link.locator);
    if (!records.has(link.specId) && !retired.has(link.specId)) issue('Unknown artifact identifier: ' + link.specId, ['artifacts', index]);
    if (links.has(key)) issue('Duplicate artifact locator: ' + key, ['artifacts', index]);
    links.add(key);
  }
  return problems.length ? { problems, deferred: [] } : success(captured(data));
}
