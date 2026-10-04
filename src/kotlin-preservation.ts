import type { Check, Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import type { KotlinFile } from './kotlin-declarations.js';
import type { ArtifactAssociation } from './specification-identity.js';
import { canonical, success } from './identity-baseline.js';
import { hash, problem } from './project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

type Declaration = KotlinQuery['declarations'][number];
type Edit = { start: number; end: number; text: string };
type RecordedFile = { id: string; path: string; generated: string; artifacts: readonly ArtifactAssociation[] };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const key = (file: string, selector: Declaration['selector']) => canonical({ file, declaration: selector });

/** Reconciles native declaration edits against the last generated text, keeping current implementation bytes. */
export async function preserveKotlin(snapshot: ProjectSnapshot, previous: readonly RecordedFile[], desired: readonly KotlinFile[]): Promise<Check<readonly FileChange[]>> {
  const problems: Diagnostic[] = [], edits = new Map<string, Edit[]>();
  const refuse = (path: string, message: string) => problems.push(problem(snapshot.root, 'output-conflict', path, message));
  const generated = (files: readonly { path: string; text: string }[]): ProjectSnapshot => ({ ...snapshot,
    files: [...snapshot.files.filter(file => !file.path.endsWith('.kt')), ...files.map(file => ({ path: file.path, bytes: Buffer.from(file.text), version: hash(Buffer.from(file.text)) }))] });
  const current = await queryKotlin(snapshot, 'expec.kotlin.json');
  if (!current.value || current.problems.length) return { problems: current.problems, deferred: [] };
  const before = await queryKotlin(generated(previous.map(file => ({ path: file.path, text: file.generated }))), 'expec.kotlin.json');
  const after = await queryKotlin(generated(desired), 'expec.kotlin.json');
  if (!before.value || before.problems.length || !after.value || after.problems.length) return { problems: [...before.problems, ...after.problems], deferred: [] };
  const sources = new Map(snapshot.files.filter(file => current.value!.files.includes(file.path)).map(file => [file.path, new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)]));
  const original = new Map(previous.map(file => [file.path, file.generated])), wanted = new Map(desired.map(file => [file.path, file.text]));
  const declarations = (query: KotlinQuery) => new Map(query.declarations.map(node => [key(node.file, node.selector), node]));
  const oldNodes = declarations(before.value), newNodes = declarations(after.value), currentNodes = declarations(current.value);
  const symbols = (files: readonly { artifacts: readonly ArtifactAssociation[] }[]) => new Map(files.flatMap(file => file.artifacts
    .filter(item => item.locator.format === 'kotlin-symbol-1').map(item => [item.specId, canonical(item.locator.value)] as const)));
  const oldSymbols = symbols(previous), newSymbols = symbols(desired), currentById = new Map<string, Declaration>();
  const edit = (file: string, range: { start: number; end: number }, text: string) => {
    if (sources.get(file)?.slice(range.start, range.end) === text) return;
    const changes = edits.get(file) ?? [];
    if (!changes.some(change => same(change, { ...range, text }))) changes.push({ ...range, text });
    edits.set(file, changes);
  };
  for (const [id, address] of oldSymbols) {
    const old = oldNodes.get(address), node = currentNodes.get(address), next = newNodes.get(newSymbols.get(id) ?? '');
    if (!old || !node) { refuse(old?.file ?? '', 'A previously generated declaration is unavailable or changed identity.'); continue; }
    currentById.set(id, node);
    if (!next) {
      if (sources.get(node.file)!.slice(node.range.start, node.range.end) !== original.get(old.file)!.slice(old.range.start, old.range.end)) {
        problems.push(problem(snapshot.root, 'handwritten-removal', node.file, 'The retired declaration contains handwritten changes.')); continue;
      }
      if (current.value.references.some(reference => reference.targetFile === node.file && same(reference.target, node.selector)
        && !(reference.file === node.file && reference.range.start >= node.range.start && reference.range.end <= node.range.end))) {
        refuse(node.file, 'A current native caller still uses the retired declaration.'); continue;
      }
      edit(node.file, node.range, ''); continue;
    }
    if (old.kind !== next.kind) { refuse(node.file, 'Native declaration category cannot change over an implementation.'); continue; }
    if (old.name !== next.name) {
      edit(node.file, node.nameRange, next.name);
      for (const reference of current.value.references) if (reference.targetFile === node.file && same(reference.target, node.selector)) edit(reference.file, reference.range, next.name);
    }
    if (old.typeRange && next.typeRange && node.typeRange) {
      const oldType = original.get(old.file)!.slice(old.typeRange.start, old.typeRange.end), nextType = wanted.get(next.file)!.slice(next.typeRange.start, next.typeRange.end);
      if (oldType !== nextType) {
        if (sources.get(node.file)!.slice(node.typeRange.start, node.typeRange.end) !== oldType) refuse(node.file, 'Both the author and specification changed this type annotation.');
        else edit(node.file, node.typeRange, nextType);
      }
    }
    if (old.kind === 'function' && !same(old.selector.at(-1)?.parameters, next.selector.at(-1)?.parameters)) refuse(node.file, 'Parameter changes require explicit native signature preservation.');
  }
  for (const [id, address] of newSymbols) if (!oldSymbols.has(id)) {
    const next = newNodes.get(address);
    if (!next) { refuse('', 'New native declaration was not found in generated source.'); continue; }
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
  return verified.problems.length || !verified.value ? { problems: verified.problems, deferred: [] } : success(changes);
}
