import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { FileChange } from '../connection/project-writer.js';
import type { KotlinFile } from './kotlin-declarations.js';
import type { ArtifactAssociation } from '../../model/specification-identity.js';
import { canonical, success } from '../../model/identity-baseline.js';
import { hash, problem } from '../connection/project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';
import { compareKotlin } from './kotlin-comparison.js';
import { kotlinDocumentation } from './kotlin-documentation.js';

type Declaration = KotlinQuery['declarations'][number];
type Edit = { start: number; end: number; text: string; replacesBinding?: true };
type RecordedFile = { id: string; path: string; generated: string; artifacts: readonly ArtifactAssociation[]; adopted?: boolean | undefined; documentation?: readonly string[] | undefined; support?: true | undefined };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const key = (file: string, selector: Declaration['selector']) => canonical({ file, declaration: selector });

/** Uses native PSI spans to remove an owned declaration from its generated contract baseline. */
export async function retireKotlin(snapshot: ProjectSnapshot, previous: readonly RecordedFile[], id: string): Promise<Check<{ files: KotlinFile[]; removed: string[] }>> {
  const inputs = previous.map((file, index) => ({ ...file, temporary: file.path.slice(0, file.path.lastIndexOf('/') + 1) + '__expec_retire_' + index + '.kt' }));
  const parsed = await queryKotlin({ ...snapshot, files: [...snapshot.files.filter(file => !file.path.endsWith('.kt')),
    ...inputs.map(file => ({ path: file.temporary, bytes: Buffer.from(file.generated), version: hash(Buffer.from(file.generated)) }))] }, 'expec.kotlin.json');
  if (!parsed.value) return { problems: parsed.problems, deferred: parsed.deferred };
  const removed = new Set<string>(), files: KotlinFile[] = [];
  for (const file of inputs) {
    const nodes = parsed.value.declarations.filter(node => node.file === file.temporary);
    const selected = nodes.filter(node => file.artifacts.some(item => item.specId === id && item.locator.format === 'kotlin-symbol-1'
      && same((item.locator.value as { declaration: Declaration['selector'] }).declaration, node.selector)));
    const inside = (selector: Declaration['selector']) => selected.some(node => same(selector.slice(0, node.selector.length), node.selector));
    const artifacts = file.artifacts.filter(item => {
      const remove = item.locator.format === 'kotlin-symbol-1' && inside((item.locator.value as { declaration: Declaration['selector'] }).declaration)
        || item.specId === id && item.locator.format === 'kotlin-file-1';
      if (remove) removed.add(item.specId); return !remove;
    });
    if (!artifacts.some(item => item.locator.format === 'kotlin-symbol-1')) continue;
    let text = file.generated;
    for (const node of selected.filter(node => !selected.some(parent => parent !== node && parent.range.start <= node.range.start && parent.range.end >= node.range.end))
      .sort((a, b) => b.range.start - a.range.start)) text = text.slice(0, node.range.start) + text.slice(node.range.end);
    files.push({ id: file.id, path: file.path, text, artifacts, ...file.adopted ? { adopted: true } : {} });
  }
  return success({ files, removed: [...removed] });
}

/** Reconciles native declaration edits against the last generated text, keeping current implementation bytes. */
export async function preserveKotlin(snapshot: ProjectSnapshot, previous: readonly RecordedFile[], desired: readonly KotlinFile[], constraints: ReadonlySet<string>, generatedSupport: ReadonlySet<string> = new Set()): Promise<Check<{ changes: readonly FileChange[]; obligations: readonly Diagnostic[] }>> {
  const problems: Diagnostic[] = [], edits = new Map<string, Edit[]>();
  const refuse = (path: string, message: string) => problems.push(problem(snapshot.root, 'output-conflict', path, message));
  const current = await queryKotlin(snapshot, 'expec.kotlin.json');
  const currentProblems = bindingProblems(current, snapshot);
  if (!current.value || currentProblems.length) return { problems: currentProblems, deferred: [] };
  const owned = previous.flatMap(file => file.artifacts);
  const recorded = previous.map(file => ({ ...file, text: file.generated }));
  const before = await compareKotlin(snapshot, current.value, recorded, owned);
  const after = await compareKotlin(snapshot, current.value, desired, owned, recorded);
  if (!before.value || before.problems.length || !after.value || after.problems.length) return { problems: [...before.problems, ...after.problems], deferred: [] };
  const sources = new Map(snapshot.files.filter(file => current.value!.files.includes(file.path)).map(file => [file.path, new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)]));
  const original = before.value.sources, wanted = after.value.sources;
  const declarations = (query: KotlinQuery) => new Map(query.declarations.map(node => [key(node.file, node.selector), node]));
  const oldNodes = declarations(before.value.native), newNodes = declarations(after.value.native), currentNodes = declarations(current.value);
  const symbols = (files: readonly { id: string; artifacts: readonly ArtifactAssociation[] }[]) => {
    const result = new Map<string, string>(), counts = new Map<string, number>();
    for (const file of files) for (const item of file.artifacts.filter(item => item.locator.format === 'kotlin-symbol-1')) {
      const selector = (item.locator.value as { declaration: Declaration['selector'] }).declaration;
      const role = canonical([file.id, item.specId, selector.at(-1)!.kind]), index = counts.get(role) ?? 0;
      counts.set(role, index + 1); result.set(role + ':' + index, canonical(item.locator.value));
    }
    return result;
  };
  const oldSymbols = symbols(previous), newSymbols = symbols(desired), currentById = new Map<string, Declaration>();
  for (const [file, declarations] of before.value.support) for (const address of declarations)
    oldSymbols.set(canonical([file, address.declaration]), canonical(address));
  for (const [file, declarations] of after.value.support) for (const address of declarations)
    newSymbols.set(canonical([file, address.declaration]), canonical(address));
  const retired = [...oldSymbols].flatMap(([id, address]) => !newSymbols.has(id) && currentNodes.has(address) ? [currentNodes.get(address)!] : []);
  const contains = (node: Declaration, file: string, range: { start: number; end: number }) => node.file === file && node.range.start <= range.start && node.range.end >= range.end;
  const references = (node: Declaration) => current.value!.references.filter(reference => reference.targetFile === node.file
    && (same(reference.target, node.selector) || reference.role === 'construction' && same(reference.target?.slice(0, -1), node.selector)));
  const edit = (file: string, range: { start: number; end: number }, text: string, replacesBinding = false) => {
    if (sources.get(file)?.slice(range.start, range.end) === text) return;
    let changes = edits.get(file) ?? [];
    if (changes.some(change => change.replacesBinding && change.start <= range.start && change.end >= range.end)) return;
    if (replacesBinding) changes = changes.filter(change => change.start < range.start || change.end > range.end);
    if (!changes.some(change => change.start === range.start && change.end === range.end && change.text === text)) changes.push({ ...range, text, ...(replacesBinding ? { replacesBinding: true as const } : {}) });
    edits.set(file, changes);
  };
  const replacements = new Map<string, string>(), replaced: { before: Declaration; after: Declaration }[] = [];
  const constrained = new Set(previous.flatMap(file => file.artifacts.filter(item => constraints.has(item.specId)).map(item => canonical(item.locator.value))));
  const generated = new Set([...before.value.support].flatMap(([id, addresses]) => generatedSupport.has(id) ? addresses.map(address => canonical(address)) : []));
  for (const address of generated) constrained.add(address);
  const generatedCaller = (reference: KotlinQuery['references'][number]) => [...constrained].some(address => {
    const node = currentNodes.get(address), old = oldNodes.get(address);
    return node?.kind === 'function' && old && contains(node, reference.file, reference.range)
      && sources.get(node.file)!.slice(node.range.start, node.range.end) === original.get(old.file)!.slice(old.range.start, old.range.end);
  });
  for (const [id, address] of oldSymbols) {
    if (!constrained.has(address)) continue;
    const old = oldNodes.get(address), node = currentNodes.get(address), next = newNodes.get(newSymbols.get(id) ?? '');
    if (!old || !node || !next || old.kind !== next.kind || old.name !== next.name || replaced.some(root => contains(root.before, node.file, node.range))) continue;
    const beforeText = original.get(old.file)!.slice(old.range.start, old.range.end), afterText = wanted.get(next.file)!.slice(next.range.start, next.range.end);
    if (beforeText === afterText) continue;
    if (sources.get(node.file)!.slice(node.range.start, node.range.end) !== beforeText || previous.some(file => file.adopted && file.artifacts.some(item => canonical(item.locator.value) === address))) {
      problems.push(problem(snapshot.root, 'handwritten-contract-change', node.file, 'A changed restriction cannot replace a handwritten or adopted native implementation.')); continue;
    }
    if (generated.has(address) && references(node).some(reference => !generatedCaller(reference) && !retired.some(removed => contains(removed, reference.file, reference.range)))) {
      refuse(node.file, 'A handwritten native caller prevents changing the meaning of this generated comparison.'); continue;
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
      if (sources.get(node.file)!.slice(node.range.start, node.range.end) !== original.get(old.file)!.slice(old.range.start, old.range.end)
        || previous.some(file => file.adopted && file.artifacts.some(item => canonical(item.locator.value) === address))) {
        problems.push(problem(snapshot.root, 'handwritten-removal', node.file, 'The retired declaration contains handwritten changes.')); continue;
      }
      if (references(node).some(reference => !retired.some(removed => contains(removed, reference.file, reference.range))
        && !replaced.some(root => contains(root.before, reference.file, reference.range)))) {
        refuse(node.file, 'A current native caller still uses the retired declaration.'); continue;
      }
      edit(node.file, node.range, '', true); continue;
    }
    if (old.kind !== next.kind) { refuse(node.file, 'Native declaration category cannot change over an implementation.'); continue; }
    const owner = previous.find(file => file.artifacts.some(item => canonical(item.locator.value) === address));
    const documented = !owner?.adopted || owner.artifacts.some(item => canonical(item.locator.value) === address && owner.documentation?.includes(item.specId));
    const doc = (declaration: Declaration, texts: ReadonlyMap<string, string>) => declaration.docRange ? texts.get(declaration.file)!.slice(declaration.docRange.start, declaration.docRange.end) : '';
    const priorDoc = doc(old, original), nextDoc = doc(next, wanted);
    if (documented && priorDoc !== nextDoc) {
      const change = kotlinDocumentation(priorDoc, doc(node, sources), nextDoc);
      if (!change) refuse(node.file, 'The generated documentation is missing, altered or ambiguous.');
      else {
        const start = node.docRange?.start ?? node.range.start;
        const indentation = sources.get(node.file)!.slice(sources.get(node.file)!.lastIndexOf('\n', start - 1) + 1, start);
        edit(node.file, { start: start + change.start, end: start + change.end }, change.text + (!node.docRange && change.text ? '\n' + indentation : ''), true);
      }
    }
    if (old.name !== next.name) {
      edit(node.file, node.nameRange, next.name);
      for (const reference of references(node)) {
        const text = sources.get(reference.file)!.slice(reference.range.start, reference.range.end);
        if (reference.name === node.name && (text === node.name || text === '`' + node.name + '`')) edit(reference.file, reference.range, next.name);
      }
    }
    if (old.typeRange && next.typeRange) {
      const oldType = original.get(old.file)!.slice(old.typeRange.start, old.typeRange.end), nextType = wanted.get(next.file)!.slice(next.typeRange.start, next.typeRange.end);
      if (oldType !== nextType) {
        if (node.typeRange) {
          if (sources.get(node.file)!.slice(node.typeRange.start, node.typeRange.end) !== oldType) refuse(node.file, 'Both the author and specification changed this type annotation.');
          else edit(node.file, node.typeRange, nextType, true);
        } else if (node.typePosition !== undefined && node.returnType === old.returnType) {
          edit(node.file, { start: node.typePosition, end: node.typePosition }, ': ' + nextType, true);
        } else refuse(node.file, 'The inferred native result no longer matches the owned signature.');
      }
    }
    if (old.kind === 'function' && !same(old.selector.at(-1)?.parameters, next.selector.at(-1)?.parameters)) {
      const parameters = (query: KotlinQuery, owner: Declaration) => query.declarations.filter(parameter => parameter.kind === 'parameter'
        && parameter.file === owner.file && same(parameter.selector.slice(0, -1), owner.selector)).sort((a, b) => a.range.start - b.range.start);
      const prior = parameters(before.value.native, old), actual = parameters(current.value, node), proposed = parameters(after.value.native, next);
      const withoutType = (parameter: Declaration, source: string) => parameter.typeRange
        ? source.slice(parameter.range.start, parameter.typeRange.start) + source.slice(parameter.typeRange.end, parameter.range.end) : undefined;
      const pairs = prior.map(parameter => {
        const address = key(parameter.file, parameter.selector), identity = [...oldSymbols].find(([, value]) => value === address)?.[0];
        return [address, identity ? newSymbols.get(identity) : undefined] as const;
      });
      const signature = (owner: Declaration) => [owner.parameterNames, owner.typeParameters, owner.selector.at(-1)?.receiver];
      const stable = same(signature(old), signature(node)) && same(signature(old), signature(next))
        && prior.length === actual.length && prior.length === proposed.length && prior.length === old.parameterNames?.length
        && prior.every((parameter, index) => {
          const current = actual[index]!, desired = proposed[index]!;
          return parameter.name === current.name && parameter.name === desired.name && parameter.hasDefault === current.hasDefault && parameter.hasDefault === desired.hasDefault
            && pairs[index]![1] === key(desired.file, desired.selector) && parameter.typeRange && current.typeRange && desired.typeRange
            && withoutType(parameter, original.get(parameter.file)!) === withoutType(desired, wanted.get(desired.file)!);
        });
      if (!stable) refuse(node.file, 'Parameter updates require the same ordered declarations, receiver, generics and default structure.');
      else {
        replacements.set(address, key(next.file, next.selector));
        for (const [before, after] of pairs) replacements.set(before, after!);
      }
    }
  }
  for (const [id, address] of newSymbols) if (!oldSymbols.has(id)) {
    const next = newNodes.get(address);
    if (!next) { refuse('', 'New native declaration was not found in generated source.'); continue; }
    if (replaced.some(root => contains(root.after, next.file, next.range))) continue;
    const ownerAddress = key(next.file, next.selector.slice(0, -1));
    const ownerId = [...newSymbols].find(([, address]) => address === ownerAddress)?.[0];
    if (!ownerId) {
      // A new support function joins its recorded file without replacing unowned neighbors.
      const file = desired.find(file => file.path === next.file && generatedSupport.has(file.id));
      if (file && (next.kind === 'function' || file.id === 'support:data') && next.selector.length === 1 && previous.some(before => before.id === file.id) && sources.has(next.file)) {
        const end = sources.get(next.file)!.length;
        edit(next.file, { start: end, end }, '\n' + wanted.get(next.file)!.slice(next.range.start, next.range.end) + '\n');
      }
      continue; // A newly created top-level file is emitted below.
    }
    if (!oldSymbols.has(ownerId)) continue; // Its new parent already contains this declaration.
    const owner = currentById.get(ownerId);
    if (!owner?.bodyRange) { refuse(next.file, 'The containing native declaration has no editable body.'); continue; }
    const source = wanted.get(next.file)!, text = source.slice(next.range.start, next.range.end);
    const indentation = source.slice(source.lastIndexOf('\n', next.range.start - 1) + 1, next.range.start);
    edit(owner.file, { start: owner.bodyRange.end - 1, end: owner.bodyRange.end - 1 }, '\n' + indentation + text + '\n');
  }

  // New generated type uses need their actual native import directives as well as declaration edits.
  for (const file of desired) {
    const prior = previous.find(item => item.id === file.id), path = prior?.path;
    if (!path || !sources.has(path)) continue;
    const oldImports = before.value.native.imports.filter(item => item.file === path).map(item => original.get(path)!.slice(item.range.start, item.range.end));
    const actualImports = current.value.imports.filter(item => item.file === path).map(item => sources.get(path)!.slice(item.range.start, item.range.end));
    const added = [...new Set(after.value.native.imports.filter(item => item.file === file.path)
      .map(item => wanted.get(file.path)!.slice(item.range.start, item.range.end))
      .filter(text => !oldImports.includes(text) && !actualImports.includes(text)))];
    if (!added.length) continue;
    const start = Math.min(...current.value.declarations.filter(node => node.file === path && node.selector.length === 1).map(node => node.range.start));
    if (!Number.isFinite(start)) { refuse(path, 'New native imports require an actual declaration boundary.'); continue; }
    edit(path, { start, end: start }, added.join('\n') + '\n\n');
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
    if (!after && !desired.some(item => item.path === file) && previous.some(item => item.path === file && !item.adopted && item.generated === sources.get(file))) {
      changes.push({ kind: 'remove', path: file });
    } else if (after && after.path !== file) {
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
  const failures = bindingProblems(verified, snapshot);
  if (failures.length || !verified.value) return { problems: failures, deferred: [] };
  const movedFiles = new Map(changes.flatMap(change => change.kind === 'move' ? [[change.from, change.to] as const] : []));
  for (const reference of changedBindings(current.value, verified.value, edits, movedFiles, replacements)) {
    problems.push(problem(snapshot.root, 'native-binding-changed', reference.file, 'A surviving native reference changes target at UTF-16 offset ' + reference.range.start + '.'));
  }
  return problems.length ? { problems, deferred: [] } : success({ changes, obligations: verified.problems });
}

/** Declaration sites retain identity across edits even when their names or signatures change. */
function changedBindings(before: KotlinQuery, after: KotlinQuery, edits: ReadonlyMap<string, readonly Edit[]>, moved: ReadonlyMap<string, string>, replacements: ReadonlyMap<string, string>): KotlinQuery['references'] {
  const position = (file: string, range: { start: number; end: number }) => {
    let offset = 0, length = range.end - range.start;
    for (const edit of edits.get(file) ?? []) {
      if (edit.end <= range.start) offset += edit.text.length - (edit.end - edit.start);
      else if (edit.start === range.start && edit.end === range.end) length = edit.text.length;
      else if (edit.start >= range.start && edit.end <= range.end) length += edit.text.length - (edit.end - edit.start);
      else if (edit.start < range.end && edit.end > range.start) return undefined;
    }
    return { file: moved.get(file) ?? file, range: { start: range.start + offset, end: range.start + offset + length } };
  };
  const declaration = (query: KotlinQuery, reference: KotlinQuery['references'][number]) => query.declarations.find(node =>
    node.file === reference.targetFile && same(node.selector, reference.target));
  const identity = (query: KotlinQuery, reference: KotlinQuery['references'][number], changed: boolean): string | undefined => {
    if (reference.external) return 'external:' + reference.external;
    const target = declaration(query, reference);
    if (!target) return undefined;
    const replacement = changed && replacements.get(key(target.file, target.selector));
    const node = replacement ? after.declarations.find(node => key(node.file, node.selector) === replacement) : target;
    if (!node) return undefined;
    const site = changed && !replacement ? position(node.file, node.nameRange) : { file: node.file, range: node.nameRange };
    return site && canonical({ kind: node.kind, ...site });
  };
  const visited = new Set<string>();
  return before.references.filter(reference => {
    if (edits.get(reference.file)?.some(edit => edit.replacesBinding && edit.start <= reference.range.start && edit.end >= reference.range.end)) return false;
    const site = position(reference.file, reference.range), location = canonical(site);
    if (!site) return true;
    if (visited.has(location)) return false; visited.add(location);
    const expected = before.references.filter(item => item.file === reference.file && same(item.range, reference.range)).map(item => identity(before, item, true));
    const actual = after.references.filter(item => item.file === site.file && same(item.range, site.range)).map(item => identity(after, item, false));
    return expected.includes(undefined) || actual.includes(undefined) || !same(expected.sort(), actual.sort());
  });
}

/** A retained body may need implementing after a deliberate result-contract change. */
function bindingProblems(checked: Check<KotlinQuery>, snapshot: ProjectSnapshot): readonly Diagnostic[] {
  const ordinary = new Set(checked.value?.problems.filter(issue => issue.code === 'RETURN_TYPE_MISMATCH'
    && checked.value!.declarations.some(node => node.file === issue.file && node.bodyRange
      && node.bodyRange.start <= issue.range.start && node.bodyRange.end >= issue.range.end))
    .map(issue => canonical(problem(snapshot.root, 'kotlin-' + issue.code, issue.file, issue.message))) ?? []);
  return checked.problems.filter(item => !ordinary.has(canonical(item)));
}
