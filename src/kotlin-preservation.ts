import type { Check, Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import type { KotlinFile } from './kotlin-declarations.js';
import type { ArtifactAssociation } from './specification-identity.js';
import { canonical, success } from './identity-baseline.js';
import { hash, problem } from './project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';
import { compareKotlin } from './kotlin-comparison.js';

type Declaration = KotlinQuery['declarations'][number];
type Edit = { start: number; end: number; text: string; replacesBinding?: true };
type RecordedFile = { id: string; path: string; generated: string; artifacts: readonly ArtifactAssociation[]; adopted?: boolean | undefined };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const key = (file: string, selector: Declaration['selector']) => canonical({ file, declaration: selector });

/** Reconciles native declaration edits against the last generated text, keeping current implementation bytes. */
export async function preserveKotlin(snapshot: ProjectSnapshot, previous: readonly RecordedFile[], desired: readonly KotlinFile[], constraints: ReadonlySet<string>): Promise<Check<readonly FileChange[]>> {
  const problems: Diagnostic[] = [], edits = new Map<string, Edit[]>();
  const refuse = (path: string, message: string) => problems.push(problem(snapshot.root, 'output-conflict', path, message));
  const current = await queryKotlin(snapshot, 'expec.kotlin.json');
  if (!current.value || current.problems.length) return { problems: current.problems, deferred: [] };
  const owned = previous.flatMap(file => file.artifacts);
  const before = await compareKotlin(snapshot, current.value, previous.map(file => ({ ...file, text: file.generated })), owned);
  const after = await compareKotlin(snapshot, current.value, desired, owned);
  if (!before.value || before.problems.length || !after.value || after.problems.length) return { problems: [...before.problems, ...after.problems], deferred: [] };
  const sources = new Map(snapshot.files.filter(file => current.value!.files.includes(file.path)).map(file => [file.path, new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)]));
  const original = before.value.sources, wanted = after.value.sources;
  const declarations = (query: KotlinQuery) => new Map(query.declarations.map(node => [key(node.file, node.selector), node]));
  const oldNodes = declarations(before.value.native), newNodes = declarations(after.value.native), currentNodes = declarations(current.value);
  const symbols = (files: readonly { artifacts: readonly ArtifactAssociation[] }[]) => {
    const result = new Map<string, string>(), counts = new Map<string, number>();
    for (const item of files.flatMap(file => file.artifacts).filter(item => item.locator.format === 'kotlin-symbol-1')) {
      const selector = (item.locator.value as { declaration: Declaration['selector'] }).declaration;
      const role = item.specId + ':' + selector.at(-1)!.kind, index = counts.get(role) ?? 0;
      counts.set(role, index + 1); result.set(role + ':' + index, canonical(item.locator.value));
    }
    return result;
  };
  const oldSymbols = symbols(previous), newSymbols = symbols(desired), currentById = new Map<string, Declaration>();
  const retired = [...oldSymbols].flatMap(([id, address]) => !newSymbols.has(id) && currentNodes.has(address) ? [currentNodes.get(address)!] : []);
  const contains = (node: Declaration, file: string, range: { start: number; end: number }) => node.file === file && node.range.start <= range.start && node.range.end >= range.end;
  const references = (node: Declaration) => current.value!.references.filter(reference => reference.targetFile === node.file
    && (same(reference.target, node.selector) || reference.role === 'construction' && same(reference.target?.slice(0, -1), node.selector)));
  const edit = (file: string, range: { start: number; end: number }, text: string, replacesBinding = false) => {
    if (sources.get(file)?.slice(range.start, range.end) === text) return;
    const changes = edits.get(file) ?? [];
    if (!changes.some(change => change.start === range.start && change.end === range.end && change.text === text)) changes.push({ ...range, text, ...(replacesBinding ? { replacesBinding: true as const } : {}) });
    edits.set(file, changes);
  };
  const replacements = new Map<string, string>(), replaced: { before: Declaration; after: Declaration }[] = [];
  const constrained = new Set(previous.flatMap(file => file.artifacts.filter(item => constraints.has(item.specId)).map(item => canonical(item.locator.value))));
  for (const [id, address] of oldSymbols) {
    if (!constrained.has(address)) continue;
    const old = oldNodes.get(address), node = currentNodes.get(address), next = newNodes.get(newSymbols.get(id) ?? '');
    if (!old || !node || !next || old.kind !== next.kind || old.name !== next.name || replaced.some(root => contains(root.before, node.file, node.range))) continue;
    const beforeText = original.get(old.file)!.slice(old.range.start, old.range.end), afterText = wanted.get(next.file)!.slice(next.range.start, next.range.end);
    if (beforeText === afterText) continue;
    if (sources.get(node.file)!.slice(node.range.start, node.range.end) !== beforeText || previous.some(file => file.adopted && file.artifacts.some(item => canonical(item.locator.value) === address))) {
      problems.push(problem(snapshot.root, 'handwritten-contract-change', node.file, 'A changed restriction cannot replace a handwritten or adopted native implementation.')); continue;
    }
    edit(node.file, node.range, afterText, true); replaced.push({ before: node, after: next });
    for (const member of current.value.declarations.filter(member => contains(node, member.file, member.range))) {
      const before = key(member.file, member.selector), identity = [...oldSymbols].find(([, value]) => value === before)?.[0];
      const after = identity ? newSymbols.get(identity) : key(next.file, member.selector);
      if (after && newNodes.has(after)) replacements.set(before, after);
    }
  }
  for (const [id, address] of oldSymbols) {
    const old = oldNodes.get(address), node = currentNodes.get(address), next = newNodes.get(newSymbols.get(id) ?? '');
    if (!old || !node) { refuse(old?.file ?? '', 'A previously generated declaration is unavailable or changed identity.'); continue; }
    currentById.set(id, node);
    if (replaced.some(root => contains(root.before, node.file, node.range))) continue;
    if (!next) {
      if (retired.some(parent => parent !== node && contains(parent, node.file, node.range))) continue;
      if (sources.get(node.file)!.slice(node.range.start, node.range.end) !== original.get(old.file)!.slice(old.range.start, old.range.end)) {
        problems.push(problem(snapshot.root, 'handwritten-removal', node.file, 'The retired declaration contains handwritten changes.')); continue;
      }
      if (references(node).some(reference => !retired.some(removed => contains(removed, reference.file, reference.range)))) {
        refuse(node.file, 'A current native caller still uses the retired declaration.'); continue;
      }
      edit(node.file, node.range, '', true); continue;
    }
    if (old.kind !== next.kind) { refuse(node.file, 'Native declaration category cannot change over an implementation.'); continue; }
    if (old.name !== next.name) {
      edit(node.file, node.nameRange, next.name);
      for (const reference of references(node)) if (reference.name === node.name) edit(reference.file, reference.range, next.name);
    }
    if (old.typeRange && next.typeRange && node.typeRange) {
      const oldType = original.get(old.file)!.slice(old.typeRange.start, old.typeRange.end), nextType = wanted.get(next.file)!.slice(next.typeRange.start, next.typeRange.end);
      if (oldType !== nextType) {
        if (sources.get(node.file)!.slice(node.typeRange.start, node.typeRange.end) !== oldType) refuse(node.file, 'Both the author and specification changed this type annotation.');
        else edit(node.file, node.typeRange, nextType, true);
      }
    }
    if (old.kind === 'function' && !same(old.selector.at(-1)?.parameters, next.selector.at(-1)?.parameters)) refuse(node.file, 'Parameter changes require explicit native signature preservation.');
  }
  for (const [id, address] of newSymbols) if (!oldSymbols.has(id)) {
    const next = newNodes.get(address);
    if (!next) { refuse('', 'New native declaration was not found in generated source.'); continue; }
    if (replaced.some(root => contains(root.after, next.file, next.range))) continue;
    const ownerAddress = key(next.file, next.selector.slice(0, -1));
    const ownerId = [...newSymbols].find(([, address]) => address === ownerAddress)?.[0];
    if (!ownerId) continue; // A newly created top-level file is emitted below.
    if (!oldSymbols.has(ownerId)) continue; // Its new parent already contains this declaration.
    const owner = currentById.get(ownerId);
    if (!owner?.bodyRange) { refuse(next.file, 'The containing native declaration has no editable body.'); continue; }
    const text = wanted.get(next.file)!.slice(next.range.start, next.range.end);
    edit(owner.file, { start: owner.bodyRange.end - 1, end: owner.bodyRange.end - 1 }, '\n    ' + text.replaceAll('\n', '\n    ') + '\n');
  }
  const changes: FileChange[] = [], moved = new Set<string>();
  for (const [file, items] of edits) {
    items.sort((a, b) => b.start - a.start || b.end - a.end);
    let text = sources.get(file)!;
    for (let i = 0; i < items.length; i++) {
      const change = items[i]!;
      if (i && change.end > items[i - 1]!.start) { refuse(file, 'Native edits overlap.'); break; }
      text = text.slice(0, change.start) + change.text + text.slice(change.end);
    }
    const before = previous.find(item => item.path === file), after = before && desired.find(item => item.id === before.id);
    if (after && after.path !== file) {
      if (sources.has(after.path)) refuse(after.path, 'The renamed native file destination already exists.');
      const owned = new Set(previous.flatMap(file => file.artifacts.filter(item => item.locator.format === 'kotlin-symbol-1').map(item => canonical(item.locator.value))));
      if (current.value.declarations.some(node => node.file === file && node.selector.length === 1 && !owned.has(key(node.file, node.selector)))) {
        refuse(file, 'Moving this file would also move an unowned top-level declaration.');
      }
      changes.push({ kind: 'move', from: file, to: after.path, bytes: Buffer.from(text) }); moved.add(after.path);
    } else changes.push({ kind: 'write', path: file, bytes: Buffer.from(text) });
  }
  for (const file of desired) if (!previous.some(old => old.id === file.id) && !moved.has(file.path)) {
    if (sources.has(file.path)) refuse(file.path, 'The new declaration destination is already owned by project code.');
    else changes.push({ kind: 'write', path: file.path, bytes: Buffer.from(file.text) });
  }
  if (problems.length) return { problems, deferred: [] };
  const proposed = new Map(snapshot.files.map(file => [file.path, file]));
  for (const change of changes) {
    if (change.kind === 'remove') proposed.delete(change.path);
    else { if (change.kind === 'move') proposed.delete(change.from); const path = change.kind === 'move' ? change.to : change.path;
      const bytes = change.bytes!; proposed.set(path, { path, bytes, version: hash(bytes) }); }
  }
  const verified = await queryKotlin({ ...snapshot, files: [...proposed.values()] }, 'expec.kotlin.json');
  if (verified.problems.length || !verified.value) return { problems: verified.problems, deferred: [] };
  const movedFiles = new Map(changes.flatMap(change => change.kind === 'move' ? [[change.from, change.to] as const] : []));
  for (const reference of changedBindings(current.value, verified.value, edits, movedFiles, replacements)) {
    problems.push(problem(snapshot.root, 'native-binding-changed', reference.file, 'A surviving native reference changes target at UTF-16 offset ' + reference.range.start + '.'));
  }
  return problems.length ? { problems, deferred: [] } : success(changes);
}

/** Declaration sites retain identity across edits even when their names or signatures change. */
function changedBindings(before: KotlinQuery, after: KotlinQuery, edits: ReadonlyMap<string, readonly Edit[]>, moved: ReadonlyMap<string, string>, replacements: ReadonlyMap<string, string>): KotlinQuery['references'] {
  const position = (file: string, range: { start: number; end: number }) => {
    let offset = 0, length = range.end - range.start;
    for (const edit of edits.get(file) ?? []) {
      if (edit.end <= range.start) offset += edit.text.length - (edit.end - edit.start);
      else if (edit.start === range.start && edit.end === range.end) length = edit.text.length;
      else if (edit.start < range.end && edit.end > range.start) return undefined;
    }
    return { file: moved.get(file) ?? file, range: { start: range.start + offset, end: range.start + offset + length } };
  };
  const declaration = (query: KotlinQuery, reference: KotlinQuery['references'][number]) => query.declarations.find(node =>
    node.file === reference.targetFile && same(node.selector, reference.target));
  return before.references.filter(reference => {
    if (edits.get(reference.file)?.some(edit => edit.replacesBinding && edit.start <= reference.range.start && edit.end >= reference.range.end)) return false;
    const site = position(reference.file, reference.range);
    if (!site) return true;
    const matches = after.references.filter(item => item.file === site.file && same(item.range, site.range));
    if (matches.length !== 1) return true;
    const next = matches[0]!;
    if (reference.external) return reference.external !== next.external;
    const target = declaration(before, reference), actual = declaration(after, next);
    const replacement = target && replacements.get(key(target.file, target.selector));
    if (replacement) return !actual || key(actual.file, actual.selector) !== replacement;
    const expected = target && position(target.file, target.nameRange);
    return !target || !actual || !expected || target.kind !== actual.kind || actual.file !== expected.file || !same(actual.nameRange, expected.range);
  });
}