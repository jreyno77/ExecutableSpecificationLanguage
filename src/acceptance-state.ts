import ts from 'typescript';
import { z } from 'zod';
import { visit } from 'jsonc-parser';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation } from './specification-identity.js';
import type { AcceptanceOptions } from './acceptance-bindings.js';
import type { NativeBaseline } from './typescript-preservation.js';
import { canonical, locatorSchema } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { diagnostic } from './typescript-capture.js';
import { nativeSelection } from './typescript-symbols.js';

const association = z.strictObject({ specId: z.string().min(1), locator: locatorSchema });
const selector = z.strictObject({ kind: z.string(), name: z.string(), static: z.boolean().optional() });
const schema = z.strictObject({ format: z.literal(1), options: z.string(), authored: z.array(z.string()), files: z.array(z.strictObject({
  id: z.string(), path: z.string(), generated: z.string(), hash: z.string(), artifacts: z.array(association),
  container: z.strictObject({ role: z.enum(['dsl', 'driver']), declaration: z.array(selector).min(1) }).optional(),
  renderedArtifacts: z.array(association).optional(), adopted: z.array(z.string()).optional(), documentation: z.array(z.string()).optional(), confirmed: z.string().optional(),
})) });
export const acceptanceStatePath = '.expec/outputs/616363657074616e6365.json';
export interface AcceptanceState { format: 1; options: string; authored: string[]; files: NativeBaseline[] }
export const acceptancePlacement = ({ adoptExisting: _permission, names: _names, imports: _imports, ...settings }: AcceptanceOptions): string => canonical(settings);

/** Reads only captured ownership evidence; generated class roles are private file keys. */
export function acceptanceState(snapshot: ProjectSnapshot, options: AcceptanceOptions): { value?: AcceptanceState; problems: Diagnostic[] } {
  const file = snapshot.files.find(file => file.path === acceptanceStatePath); if (!file) return { problems: [] };
  try {
    const text = new TextDecoder('utf8', { fatal: true }).decode(file.bytes), keys: Set<string>[] = [];
    visit(text, { onObjectBegin: () => { keys.push(new Set()); }, onObjectEnd: () => { keys.pop(); }, onObjectProperty: name => {
      if (keys.at(-1)!.has(name)) throw Error('Duplicate state property'); keys.at(-1)!.add(name);
    } });
    const value = schema.parse(JSON.parse(text));
    if (new Set(value.files.map(file => file.id)).size !== value.files.length || new Set(value.files.map(file => file.path)).size !== value.files.length
      || value.files.some(file => !literal(file.path) || hash(Buffer.from(file.generated)) !== file.hash || file.artifacts.some(item => item.locator.outputId !== 'acceptance'
        || (item.locator.value as { file: string }).file !== file.path))) throw Error('Invalid ownership');
    return { value: value as AcceptanceState, problems: value.options === acceptancePlacement(options) ? [] : [diagnostic('output-options-changed', 'Acceptance placement requires an explicit migration.', acceptanceStatePath)] };
  } catch { return { problems: [diagnostic('invalid-output-state', 'Recorded acceptance ownership or generated text is invalid.', acceptanceStatePath)] }; }
}

/** Retains the proved native sync/Promise form while the DSL remains asynchronous. */
export function driverContracts(text: string, path: string, artifacts: readonly ArtifactAssociation[], baseline: string, adopting: boolean, previous = artifacts): string {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), prior = ts.createSourceFile(path, baseline, ts.ScriptTarget.Latest, true), edits: { start: number; end: number; text: string }[] = [];
  for (const artifact of artifacts) {
    const selectors = (artifact.locator.value as unknown as { declaration: readonly import('./typescript-symbols.js').Selector[] }).declaration;
    const old = previous.find(item => item.specId === artifact.specId), oldSelectors = old && (old.locator.value as unknown as { declaration: readonly import('./typescript-symbols.js').Selector[] }).declaration;
    const wanted = nativeSelection(source, selectors)[0], current = oldSelectors && nativeSelection(prior, oldSelectors)[0];
    if (!wanted || !current || !ts.isMethodDeclaration(wanted) || !ts.isMethodDeclaration(current) || !wanted.body || !current.body) continue;
    if (adopting) edits.push({ start: wanted.getStart(), end: wanted.body.getStart(), text: baseline.slice(current.getStart(), current.body.getStart()) });
    else if (!current.modifiers?.some(item => item.kind === ts.SyntaxKind.AsyncKeyword)) {
      const async = wanted.modifiers?.find(item => item.kind === ts.SyntaxKind.AsyncKeyword); if (async) edits.push({ start: async.getStart(), end: async.end + 1, text: '' });
      if (wanted.type && current.type && !(ts.isTypeReferenceNode(current.type) && current.type.typeName.getText() === 'Promise')
        && ts.isTypeReferenceNode(wanted.type) && wanted.type.typeArguments?.length === 1) edits.push({ start: wanted.type.getStart(), end: wanted.type.end, text: wanted.type.typeArguments[0]!.getText() });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
