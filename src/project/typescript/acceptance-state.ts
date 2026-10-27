import ts from 'typescript';
import { z } from 'zod';
import { visit } from 'jsonc-parser';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectFile, ProjectSnapshot } from '../connection/project-connection.js';
import type { ArtifactAssociation } from '../../model/specification-identity.js';
import { mappingSchema, type AcceptanceMapping, type AcceptanceOptions } from './acceptance-bindings.js';
import type { NativeBaseline } from './typescript-preservation.js';
import { canonical, locatorSchema } from '../../model/identity-baseline.js';
import { hash, literal } from '../connection/project-files.js';
import { diagnostic } from './typescript-capture.js';
import { nativeSelection } from './typescript-symbols.js';

const association = z.strictObject({ specId: z.string().min(1), locator: locatorSchema });
const selector = z.strictObject({ kind: z.string(), name: z.string(), static: z.boolean().optional() });
const location = z.union([
  z.strictObject({ outputId: z.literal('acceptance'), format: z.literal('typescript-file-1'), value: z.strictObject({ file: z.string().refine(literal) }) }),
  z.strictObject({ outputId: z.literal('acceptance'), format: z.literal('vitest-test-1'), value: z.strictObject({ file: z.string().refine(literal), id: z.string() }) }),
  z.strictObject({ outputId: z.literal('acceptance'), format: z.literal('typescript-symbol-1'), value: z.strictObject({ file: z.string().refine(literal), declaration: z.tuple([
    z.strictObject({ kind: z.literal('class'), name: z.string().min(1) }),
    z.strictObject({ kind: z.enum(['method', 'property']), name: z.string().min(1), static: z.literal(false) }),
  ]) }) }),
]);
const schema = z.strictObject({ format: z.literal(1), options: z.string(), mappings: z.array(mappingSchema), deleted: z.array(z.string()), authored: z.array(z.string()), files: z.array(z.strictObject({
  id: z.string(), path: z.string(), generated: z.string(), hash: z.string(), artifacts: z.array(association),
  container: z.strictObject({ role: z.enum(['dsl', 'driver']), declaration: z.array(selector).min(1) }).optional(),
  renderedArtifacts: z.array(association).optional(), adopted: z.array(z.string()).optional(), documentation: z.array(z.string()).optional(), confirmed: z.string().optional(),
})) });
export const acceptanceStatePath = '.expec/outputs/616363657074616e6365.json';
export interface AcceptanceState { format: 1; options: string; mappings: AcceptanceMapping[]; deleted: string[]; authored: string[]; files: NativeBaseline[] }
export const acceptancePlacement = ({ adoptExisting: _permission, names: _names, imports: _imports, ...settings }: AcceptanceOptions): string => canonical(settings);

/** Only the first default-to-authored fixture selection changes placement. */
export function initialFixtureSelection(state: AcceptanceState, options: AcceptanceOptions): boolean {
  const { fixture, ...unchanged } = options;
  return !!fixture && state.options === acceptancePlacement(unchanged);
}

export function testIdentities(statement: ts.Statement): string[] {
  const source = statement.getSourceFile();
  return (ts.getLeadingCommentRanges(source.text, statement.pos) ?? []).flatMap(range => {
    const match = /^\/\* @expec-test (.+) \*\/$/.exec(source.text.slice(range.pos, range.end));
    if (!match) return [];
    try { const id: unknown = JSON.parse(match[1]!); return typeof id === 'string' ? [id] : []; } catch { return []; }
  });
}

/** Reads only captured ownership evidence; generated class roles are private file keys. */
export function acceptanceState(snapshot: ProjectSnapshot, options: AcceptanceOptions): { value?: AcceptanceState; problems: Diagnostic[] } {
  const file = snapshot.files.find(file => file.path === acceptanceStatePath); if (!file) return { problems: [] };
  try {
    const text = new TextDecoder('utf8', { fatal: true }).decode(file.bytes), keys: Set<string>[] = [];
    visit(text, { onObjectBegin: () => { keys.push(new Set()); }, onObjectEnd: () => { keys.pop(); }, onObjectProperty: name => {
      if (keys.at(-1)!.has(name)) throw Error('Duplicate state property'); keys.at(-1)!.add(name);
    } });
    const value = schema.parse(JSON.parse(text));
    const artifacts = value.files.flatMap(file => file.artifacts);
    if (new Set(value.deleted).size !== value.deleted.length || value.deleted.some(id => artifacts.some(item => item.specId === id))
      || new Set(artifacts.map(item => canonical(item.locator))).size !== artifacts.length
      || artifacts.some(item => !location.safeParse(item.locator).success || item.locator.format === 'vitest-test-1' && (item.locator.value as { id: string }).id !== item.specId)
      || new Set(value.mappings.map(item => item.id)).size !== value.mappings.length || new Set(value.files.map(file => file.id)).size !== value.files.length || new Set(value.files.map(file => file.path)).size !== value.files.length
      || value.files.some(file => !literal(file.path) || hash(Buffer.from(file.generated)) !== file.hash || file.artifacts.some(item => item.locator.outputId !== 'acceptance'
        || (item.locator.value as { file: string }).file !== file.path)
        || file.adopted?.some(id => !file.artifacts.some(item => item.specId === id))
        || file.renderedArtifacts?.some(item => !location.safeParse(item.locator).success || !file.artifacts.some(actual => actual.specId === item.specId))
        || file.container && (file.id !== file.container.role || file.container.declaration.length !== 1 || file.container.declaration[0]!.kind !== 'class'))) throw Error('Invalid ownership');
    for (const file of value.files) {
      const source = ts.createSourceFile(file.path, file.generated, ts.ScriptTarget.Latest, true), rendered = file.renderedArtifacts ?? file.artifacts;
      const identities = (items: readonly ArtifactAssociation[]): string => canonical(items.map(item => [item.specId, item.locator.format]).sort());
      if (identities(rendered) !== identities(file.artifacts) || rendered.some(item => item.locator.format === 'typescript-symbol-1'
        && nativeSelection(source, (item.locator.value as unknown as { declaration: import('./typescript-symbols.js').Selector[] }).declaration).length !== 1)) throw Error('Missing generated native member');
      const markers = source.statements.flatMap(statement => testIdentities(statement));
      if (rendered.some(item => item.locator.format === 'vitest-test-1' && markers.filter(id => id === item.specId).length !== 1)) throw Error('Missing generated native test');
    }
    return { value: value as AcceptanceState, problems: value.options === acceptancePlacement(options) ? [] : [diagnostic('output-options-changed', 'Acceptance placement requires an explicit migration.', acceptanceStatePath)] };
  } catch { return { problems: [diagnostic('invalid-output-state', 'Recorded acceptance ownership or generated text is invalid.', acceptanceStatePath)] }; }
}

/** A completed handwriting confirmation has no new generated contracts or ownership. */
export function confirmationOnly(before: AcceptanceState, after: AcceptanceState, original: readonly Pick<ProjectFile, 'path' | 'version'>[]): boolean {
  const structure = (state: AcceptanceState) => canonical({ ...state, files: state.files.map(({ confirmed: _confirmed, ...file }) => file) });
  if (structure(before) !== structure(after)) return false;
  let changed = false;
  for (const [index, file] of after.files.entries()) {
    const prior = before.files[index]!.confirmed;
    if (file.confirmed === prior) continue;
    if (prior !== undefined && !/^[a-f0-9]{64}$/.test(prior) || !file.confirmed || !/^[a-f0-9]{64}$/.test(file.confirmed)
      || original.find(original => original.path === file.path)?.version !== file.confirmed) return false;
    changed = true;
  }
  return changed;
}

/** Retains the proved native sync/Promise form while the DSL remains asynchronous. */
export function driverContracts(text: string, path: string, artifacts: readonly ArtifactAssociation[], baseline: string, adopting: boolean, previous = artifacts): string {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), prior = ts.createSourceFile(path, baseline, ts.ScriptTarget.Latest, true), edits: { start: number; end: number; text: string }[] = [];
  for (const artifact of artifacts) {
    const selectors = (artifact.locator.value as unknown as { declaration: readonly import('./typescript-symbols.js').Selector[] }).declaration;
    const old = previous.find(item => item.specId === artifact.specId), oldSelectors = old && (old.locator.value as unknown as { declaration: readonly import('./typescript-symbols.js').Selector[] }).declaration;
    const wanted = nativeSelection(source, selectors)[0], current = oldSelectors && nativeSelection(prior, oldSelectors)[0];
    if (!wanted || !current || !ts.isMethodDeclaration(wanted) || !ts.isMethodDeclaration(current) || !wanted.body || !current.body) continue;
    if (adopting) edits.push({ start: wanted.getStart(), end: wanted.body.getStart(), text:
      baseline.slice(current.getStart(), current.name.getStart()) + wanted.name.getText() + baseline.slice(current.name.end, current.body.getStart()) });
    else if (!current.modifiers?.some(item => item.kind === ts.SyntaxKind.AsyncKeyword)) {
      const async = wanted.modifiers?.find(item => item.kind === ts.SyntaxKind.AsyncKeyword); if (async) edits.push({ start: async.getStart(), end: async.end + 1, text: '' });
      if (wanted.type && current.type && !(ts.isTypeReferenceNode(current.type) && current.type.typeName.getText() === 'Promise')
        && ts.isTypeReferenceNode(wanted.type) && wanted.type.typeArguments?.length === 1) edits.push({ start: wanted.type.getStart(), end: wanted.type.end, text: wanted.type.typeArguments[0]!.getText() });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
