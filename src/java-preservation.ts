import type { ArtifactAssociation } from './specification-identity.js';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import type { JavaFile } from './java-declarations.js';
import type { z } from 'zod';
import { analyzeJava, javaSymbol, type JavaFacts } from './java-analysis.js';
import { canonical, type JsonValue } from './identity-baseline.js';
import { javaProblem } from './java-settings.js';
import { hash } from './project-files.js';
import { survivingJavaBindings, type JavaEdit } from './java-bindings.js';

export interface JavaBaseline extends JavaFile { hash: string; renderedArtifacts?: ArtifactAssociation[] | undefined; adopted?: string[] | undefined }
type Declaration = JavaFacts['declarations'][number];
const address = (item: ArtifactAssociation) => item.locator.value as z.infer<typeof javaSymbol>;
const selected = (facts: JavaFacts, item: ArtifactAssociation): Declaration[] => {
  const at = address(item);
  return facts.declarations.filter(node => node.file === at.file && node.type === at.type && canonical(node.member) === canonical(at.member) && node.parameter === at.parameter);
};
const text = (snapshot: ProjectSnapshot, path: string): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.files.find(file => file.path === path)!.bytes);
const replaceFiles = (snapshot: ProjectSnapshot, values: ReadonlyMap<string, string>): ProjectSnapshot => ({ ...snapshot,
  files: [...snapshot.files.filter(file => !values.has(file.path)), ...[...values].map(([path, source]) => ({ path, bytes: Buffer.from(source), version: hash(Buffer.from(source)) }))] });

/** Native contract correspondence; handwritten source is never used as the generated baseline. */
export class JavaPreservation {
  readonly problems: Diagnostic[] = [];
  constructor(private readonly snapshot: ProjectSnapshot, private readonly configFile: string) {}
  async adopt(desired: readonly JavaFile[], mappings: readonly ArtifactAssociation[]): Promise<JavaBaseline[]> {
    const actual = await analyzeJava(this.snapshot, this.configFile);
    this.problems.push(...actual.problems);
    if (this.problems.length) return [];
    const { facts: expected, placements, comparisons } = await this.nativeView(desired, mappings, actual.facts);
    const result: JavaBaseline[] = [];
    for (const file of desired) {
      const path = placements.get(file.path);
      if (!path) { result.push({ ...file, hash: hash(Buffer.from(file.generated)), renderedArtifacts: structuredClone(file.artifacts), adopted: [] }); continue; }
      const artifacts = file.artifacts.map(item => ({ ...item, locator: { ...item.locator, value: { ...(item.locator.value as Record<string, JsonValue>), file: path } } }));
      for (const item of artifacts) {
        const found = selected(actual.facts, item), wanted = selected(expected, item), at = address(item);
        const explicit = mappings.filter(mapping => mapping.specId === item.specId && mapping.locator.outputId === item.locator.outputId);
        const matches = explicit.some(mapping => mapping.locator.format === 'java-symbol-1' && canonical(address(mapping)) === canonical(at));
        const parent = at.parameter !== undefined && artifacts.find(mapping => address(mapping).parameter === undefined
          && address(mapping).type === at.type && canonical(address(mapping).member) === canonical(at.member));
        const derived = !explicit.length && parent && mappings.some(mapping => mapping.specId === parent.specId
          && mapping.locator.format === 'java-symbol-1' && canonical(address(mapping)) === canonical(address(parent)));
        if (!matches && !derived) this.problems.push(javaProblem('native-mapping-required',
          'Adoption requires an explicit association for this declaration inside its mapped owner.', path, found[0]?.start ?? 0, found[0]?.length ?? 0));
        if (found.length !== 1 || wanted.length !== 1 || canonical(found[0]?.contract) !== canonical(wanted[0]?.contract))
          this.problems.push(javaProblem('native-contract-conflict', 'The mapped declaration does not match the checked native signature.', path, found[0]?.start ?? 0, found[0]?.length ?? 0));
        else if (at.parameter !== undefined) {
          const native = text(this.snapshot, path).slice(found[0]!.start, found[0]!.start + found[0]!.length);
          const source = comparisons.get(wanted[0]!.file)!;
          if (native !== source.slice(wanted[0]!.start, wanted[0]!.start + wanted[0]!.length))
            this.problems.push(javaProblem('native-contract-conflict', 'The mapped callable parameter name or order differs from the checked contract.', path, found[0]!.start, found[0]!.length));
        }
      }
      result.push({ ...file, path, artifacts, hash: hash(Buffer.from(file.generated)), renderedArtifacts: structuredClone(file.artifacts), adopted: artifacts.map(item => item.specId) });
    }
    return result;
  }
  async remove(previous: readonly JavaBaseline[], id: string): Promise<{ files: JavaBaseline[]; changes: FileChange[] }> {
    const found = previous.filter(file => file.artifacts.some(item => item.specId === id));
    if (found.length !== 1) { this.problems.push(javaProblem('mapping-not-found', 'Select one owned generated Java artifact.', '<associations>')); return { files: [], changes: [] }; }
    const file = found[0]!, root = file.artifacts.find(item => item.specId === id && item.locator.format === 'java-symbol-1' && !address(item).member);
    const actual = await analyzeJava(this.snapshot, this.configFile); this.problems.push(...actual.problems);
    for (const use of actual.facts.unresolved) this.problems.push(javaProblem('unresolved-native-reference', use.reason, use.file, use.start, use.length));
    const node = root && selected(actual.facts, root)[0], current = this.snapshot.files.find(item => item.path === file.path);
    if (!root || !node || !current) this.problems.push(javaProblem('unsupported-native-removal', 'Removal needs an exact owned native root.', file.path));
    else if (file.adopted?.length || hash(current.bytes) !== file.hash)
      this.problems.push(javaProblem('implemented-removal', 'The artifact contains adopted or handwritten source; preserve it explicitly.', file.path, node.start, node.length));
    if (current && hash(current.bytes) !== file.hash) {
      const baseline = await analyzeJava(replaceFiles(this.snapshot, new Map([[file.path, file.generated]])), this.configFile);
      const commentText = (source: string, at: { start: number; length: number }) => source.slice(at.start, at.start + at.length).replace(/\n[ \t]*/g, '\n');
      const generated = baseline.facts.comments.filter(item => item.file === file.path).map(item => commentText(file.generated, item));
      const comments = actual.facts.comments.filter(item => item.file === file.path), source = text(this.snapshot, file.path);
      for (const comment of comments) {
        const value = commentText(source, comment), expected = generated.filter(item => item === value).length;
        if (!expected) this.problems.push(javaProblem('handwritten-comment-conflict', 'Removing this artifact would discard a handwritten comment.', file.path, comment.start, comment.length));
        else if (comment.documentation && comments.filter(item => commentText(source, item) === value).length > expected)
          this.problems.push(javaProblem('ambiguous-documentation', 'Generated documentation has more than one possible owner.', file.path, comment.start, comment.length));
      }
    }
    if (root) for (const use of actual.facts.uses.filter(use => use.file !== file.path && use.type === address(root).type && !use.external))
      this.problems.push(javaProblem('native-incoming-use', 'A known native caller still requires this declaration.', use.file, use.start, use.length));
    return this.problems.length ? { files: [], changes: [] }
      : { files: previous.filter(item => item !== file), changes: [{ kind: 'remove', path: file.path }] };
  }
  async update(previous: readonly JavaBaseline[], desired: readonly JavaFile[]): Promise<{ files: JavaBaseline[]; changes: FileChange[] }> {
    const actual = await analyzeJava(this.snapshot, this.configFile), mappings = previous.flatMap(file => file.artifacts);
    this.problems.push(...actual.problems);
    const empty = { files: [], changes: [] };
    if (this.problems.length) return empty;
    for (const item of mappings.filter(item => item.locator.format === 'java-symbol-1')) {
      const at = address(item), candidates = desired.flatMap(file => file.artifacts).filter(wanted => wanted.specId === item.specId
        && wanted.locator.format === 'java-symbol-1' && address(wanted).member?.kind === at.member?.kind && address(wanted).parameter === at.parameter);
      const renamed = candidates.length && candidates.every(wanted => at.member?.kind === 'method'
        ? address(wanted).member?.kind === 'method' && (address(wanted).member as { name: string }).name !== at.member!.name
        : !at.member && address(wanted).type !== at.type);
      if (renamed) for (const node of selected(actual.facts,item)) for (const use of actual.facts.uses.filter(use => use.key === node.key && use.file.startsWith('file:')))
        this.problems.push(javaProblem('read-only-native-use','The known native caller cannot be rewritten.',use.file,use.start,use.length));
    }
    if (this.problems.length) return empty;
    const original = previous.map(file => ({ ...file, path: (file.renderedArtifacts?.[0] ? address(file.renderedArtifacts[0]).file : file.path), artifacts: file.renderedArtifacts ?? file.artifacts }));
    const before = await this.nativeView(original, mappings, actual.facts, previous), after = await this.nativeView(desired, mappings, actual.facts, previous);
    if (this.problems.length) return empty;
    const role = (item: ArtifactAssociation, items: readonly ArtifactAssociation[]) => {
      const at = address(item), member = at.member;
      const base = item.specId + ':' + (member?.kind ?? 'type') + ':' + (at.parameter === undefined ? 'declaration' : 'parameter');
      const variants = items.filter(other => other.specId === item.specId && address(other).member?.kind === member?.kind
        && (address(other).parameter === undefined) === (at.parameter === undefined));
      return base + (variants.length > 1 ? ':' + (member && member.kind !== 'field' ? canonical(member.parameters) : at.type) : '');
    };
    const old = new Map(mappings.filter(item => item.locator.format === 'java-symbol-1').map(item => [role(item, mappings), item]));
    const files = desired.map(file => {
      const path = after.placements.get(file.path) ?? file.path, artifacts = file.artifacts.map(item => ({ ...item, locator: { ...item.locator, value: { ...(item.locator.value as Record<string, JsonValue>), file: path } } }));
      return { ...file, path, artifacts, hash: hash(Buffer.from(file.generated)), renderedArtifacts: structuredClone(file.artifacts),
        adopted: [...new Set(previous.flatMap(record => record.adopted ?? []))].filter(id => artifacts.some(item => item.specId === id)) };
    });
    const desiredMappings = files.flatMap(file => file.artifacts);
    const next = new Map(desiredMappings.filter(item => item.locator.format === 'java-symbol-1').map(item => [role(item, desiredMappings), item]));
    const signatureChanges: ArtifactAssociation[] = [];
    const patches = new Map<string, JavaEdit[]>(), renamed: { node: Declaration; previous: ArtifactAssociation; next: ArtifactAssociation }[] = [];
    const moves = new Map<string, string>();
    const references = (node: Declaration, item: ArtifactAssociation) => actual.facts.uses.filter(use => use.key === node.key
      || !address(item).member && use.type === address(item).type && use.member?.kind === 'constructor' && !use.external);
    const fail = (node: Declaration | undefined, path: string, code: string, message: string) => this.problems.push(javaProblem(code, message, path, node?.start ?? 0, node?.length ?? 0));
    const patch = (path: string, start: number, end: number, content: string, name = false) => {
      const values = patches.get(path) ?? [], same = values.find(value => value.start === start && value.end === end);
      if (same && same.content !== content && start === end) same.content += content;
      else if (!same) values.push({ start, end, content, name });
      else if (same.content !== content) fail(undefined, path, 'native-edit-conflict', 'Native edit claims disagree.');
      patches.set(path, values);
    };
    for (const [key, item] of old) {
      const node = selected(actual.facts, item), baseline = selected(before.facts, item), wanted = next.get(key);
      if (node.length !== 1 || baseline.length !== 1 || canonical(node[0]?.contract) !== canonical(baseline[0]?.contract)) {
        fail(node[0], address(item).file, 'contract-drift', 'The owned native signature differs from its generated baseline.'); continue;
      }
      if (!wanted && address(item).parameter !== undefined) continue;
      if (!wanted) { fail(node[0], address(item).file, 'unsupported-native-removal', 'Native declaration removal has not been established for this change.'); continue; }
      const expected = selected(after.facts, wanted);
      if (expected.length !== 1) { fail(node[0], address(item).file, 'native-contract-conflict', 'The desired native contract is unavailable.'); continue; }
      const source = text(this.snapshot, node[0]!.file), desiredText = after.comparisons.get(expected[0]!.file)!;
      if (address(item).parameter !== undefined) continue;
      if (node[0]!.syntax && expected[0]!.syntax) {
        this.methodEdits(node[0]!, baseline[0]!, expected[0]!, before.comparisons.get(baseline[0]!.file)!, desiredText, previous.some(file => file.adopted?.includes(item.specId)), patch);
        if (canonical(node[0]!.contract) !== canonical(expected[0]!.contract)) signatureChanges.push(wanted);
      } else if (canonical(node[0]!.contract) !== canonical(expected[0]!.contract)) {
        fail(node[0], address(item).file, 'unsupported-native-signature', 'This native signature transformation requires explicit preservation.'); continue;
      }
      const name = desiredText.slice(expected[0]!.start, expected[0]!.start + expected[0]!.length);
      if (source.slice(node[0]!.start, node[0]!.start + node[0]!.length) === name) continue;
      if (!address(item).member) moves.set(address(item).file, address(wanted).file);
      patch(node[0]!.file, node[0]!.start, node[0]!.start + node[0]!.length, name, true); renamed.push({ node: node[0]!, previous: item, next: wanted });
      for (const use of references(node[0]!, item)) {
        if (use.file.startsWith('file:')) this.problems.push(javaProblem('read-only-native-use', 'The known native caller cannot be rewritten.', use.file, use.start, use.length));
        else patch(use.file, use.start, use.start + use.length, name, true);
      }
    }
    for (const [key, item] of next) {
      if (old.has(key) || address(item).parameter !== undefined || !this.snapshot.files.some(file => file.path === address(item).file)) continue;
      const at = address(item), wanted = selected(after.facts, item);
      const owners = actual.facts.declarations.filter(node => node.file === at.file && node.type === at.type && !node.member);
      const root = owners.length === 1 ? owners[0] : undefined;
      if (!root || wanted.length !== 1 || !at.member || at.member.kind !== 'method') {
        fail(root, at.file, 'unsupported-native-addition', 'This declaration needs an explicit native insertion location.'); continue;
      }
      const source = after.comparisons.get(wanted[0]!.file)!, body = source.slice(wanted[0]!.nodeStart, wanted[0]!.nodeStart + wanted[0]!.nodeLength);
      patch(root.file, root.nodeStart + root.nodeLength - 1, root.nodeStart + root.nodeLength - 1, '\n    ' + body.replaceAll('\n', '\n    ') + '\n');
    }
    if (this.problems.length) return empty;
    const values = new Map<string, string>();
    for (const [path, edits] of patches) {
      let source = text(this.snapshot, path), boundary = source.length;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        if (edit.end > boundary) { fail(undefined, path, 'native-edit-conflict', 'Native edit spans overlap.'); break; }
        source = source.slice(0, edit.start) + edit.content + source.slice(edit.end); boundary = edit.start;
      }
      values.set(path, source);
    }
    if (this.problems.length) return empty;
    for (const file of files) if (!this.snapshot.files.some(current => current.path === file.path)) values.set(file.path, file.generated);
    for (const [from, to] of moves) { values.set(to, values.get(from) ?? text(this.snapshot, from)); values.delete(from); }
    const final = await analyzeJava(replaceFiles({ ...this.snapshot, files: this.snapshot.files.filter(file => !moves.has(file.path)) }, values), this.configFile);
    const obligations = signatureChanges.flatMap(item => selected(final.facts, item));
    this.problems.push(...final.problems.filter(problem => !problem.code.startsWith('java-') || problem.code.startsWith('java-syntax-')
      || !obligations.some(node => problem.at.kind === 'dependency' && problem.at.path[1] === node.file && typeof problem.at.path[2] === 'number'
        && node.syntax?.body && problem.at.path[2] >= node.syntax.body.start && problem.at.path[2] < node.syntax.body.start + node.syntax.body.length)));
    for (const item of desiredMappings.filter(item => item.locator.format === 'java-symbol-1')) if (selected(final.facts, item).length !== 1)
      this.problems.push(javaProblem('native-contract-conflict', 'The planned source does not retain exactly one promised declaration.', address(item).file));
    const invalidBodies = obligations.flatMap(node => node.syntax?.body && final.facts.problems.some(problem => problem.file === node.file
      && problem.code.startsWith('java-') && !problem.code.startsWith('java-syntax-')
      && problem.start >= node.syntax!.body!.start && problem.start < node.syntax!.body!.start + node.syntax!.body!.length)
      ? [{ file: node.file, ...node.syntax.body }] : []);
    this.problems.push(...survivingJavaBindings(actual.facts, final.facts, patches, moves, invalidBodies));
    for (const change of renamed) {
      const expected = selected(final.facts, change.next);
      for (const use of references(change.node, change.previous)) {
        const offset = use.start + (patches.get(use.file) ?? []).filter(edit => edit.start < use.start).reduce((sum, edit) => sum + edit.content.length - edit.end + edit.start, 0);
        if (expected.length !== 1 || !final.facts.uses.some(after => after.file === (moves.get(use.file) ?? use.file) && after.start === offset
          && (after.key === expected[0]!.key || !address(change.previous).member && use.member?.kind === 'constructor'
            && after.type === address(change.next).type && after.member?.kind === 'constructor' && !after.external)))
          this.problems.push(javaProblem('native-binding-conflict', 'Renaming would change the native target of this caller.', use.file, use.start, use.length));
      }
    }
    return { files, changes: [...[...moves.keys()].map(path => ({ kind: 'remove' as const, path })),
      ...[...values].filter(([path, value]) => !this.snapshot.files.some(file => file.path === path) || text(this.snapshot, path) !== value)
        .map(([path, value]) => ({ kind: 'write' as const, path, bytes: Buffer.from(value) }))] };
  }
  private methodEdits(node: Declaration, baseline: Declaration, wanted: Declaration, original: string, desired: string, manual: boolean,
    patch: (file: string, start: number, end: number, content: string) => void): void {
    const current = text(this.snapshot, node.file), source = node.syntax!, before = baseline.syntax!, next = wanted.syntax!;
    const part = (text: string, at: { start: number; length: number }) => text.slice(at.start, at.start + at.length);
    if (!manual && source.body && before.body && next.body && part(current, source.body) === part(original, before.body)
      && part(current, source.body) !== part(desired, next.body))
      patch(node.file, source.body.start, source.body.start + source.body.length, part(desired, next.body));
    const doc = (text: string, at: { start: number; length: number }) => part(text, at).replace(/\n[ \t]*/g, '\n');
    const oldDocs = before.docs.map(at => doc(original, at)), newDocs = next.docs.map(at => doc(desired, at));
    if (canonical(oldDocs) !== canonical(newDocs)) {
      for (const value of oldDocs) {
        const matches = source.docs.filter(at => doc(current, at) === value);
        if (matches.length > 1) { this.problems.push(javaProblem('ambiguous-documentation', 'Generated documentation has more than one possible owner.', node.file, matches[0]!.start)); return; }
        if (matches[0]) patch(node.file, matches[0].start, matches[0].start + matches[0].length, '');
      }
      if (newDocs.length) patch(node.file, node.nodeStart, node.nodeStart, next.docs.map(at => part(desired, at)).join('\n') + '\n');
    }
    const native = node.contract as Record<string, JsonValue>, requested = wanted.contract as Record<string, JsonValue>;
    const shape = (value: Declaration) => { const contract = value.contract as Record<string, JsonValue>; return { kind: contract.kind, public: contract.public, static: contract.static, throws: contract.throws }; };
    if (canonical(shape(node)) !== canonical(shape(wanted))) {
      this.problems.push(javaProblem('unsupported-native-signature', 'This callable modifier or throws change requires an explicit transformation.', node.file, node.start)); return;
    }
    if (source.result && next.result && native.result !== requested.result)
      patch(node.file, source.result.start, source.result.start + source.result.length, part(desired, next.result));
    for (let index = 0; index < Math.min(source.parameters.length, next.parameters.length); index++) {
      const at = source.parameters[index]!, to = next.parameters[index]!;
      if (part(current, at.name) !== part(desired, to.name)) {
        this.problems.push(javaProblem('unsupported-native-signature', 'Parameter renames require their bound native references.', node.file, at.name.start)); continue;
      }
      if (canonical((native.parameters as readonly JsonValue[])[index]) !== canonical((requested.parameters as readonly JsonValue[])[index])) patch(node.file, at.type.start, at.type.start + at.type.length, part(desired, to.type));
    }
    if (next.parameters.length > source.parameters.length) patch(node.file, source.close, source.close,
      (source.parameters.length ? ', ' : '') + next.parameters.slice(source.parameters.length).map(at => part(desired, at)).join(', '));
    if (next.parameters.length < source.parameters.length) {
      const first = source.parameters[next.parameters.length]!, previous = source.parameters[next.parameters.length - 1];
      const start = previous ? previous.start + previous.length : first.start;
      const comment = source.comments.find(at => at.start >= start && at.start < source.close);
      if (comment) this.problems.push(javaProblem('handwritten-comment-conflict', 'Removing this parameter would discard its handwritten comment.', node.file, comment.start, comment.length));
      else patch(node.file, start, source.close, '');
    }
  }
  private async nativeView(desired: readonly JavaFile[], mappings: readonly ArtifactAssociation[], actual: JavaFacts, owned: readonly JavaBaseline[] = []) {
    const rendered = await analyzeJava(replaceFiles(this.snapshot, new Map(desired.map(file => [file.path, file.generated]))), this.configFile);
    this.problems.push(...rendered.problems.filter(problem => !problem.code.startsWith('java-')));
    const comparisons = new Map<string, string>(), edits = new Map<string, { node: Declaration; content: string }[]>();
    const placements = new Map<string, string>(), removed = new Set<string>();
    for (const file of desired) {
      const artifacts = file.artifacts.filter(item => item.locator.format === 'java-symbol-1');
      const roots = rendered.facts.declarations.filter(node => node.file === file.path && !node.member && artifacts.some(item => address(item).type === node.type));
      const mapped = mappings.filter(item => item.locator.format === 'java-symbol-1' && artifacts.some(root => root.specId === item.specId))
        .flatMap(item => actual.declarations.filter(node => !node.member && node.file === address(item).file && node.type === address(item).type
          && roots.some(root => canonical(root.contract) === canonical(node.contract))));
      const placementsFound = [...new Map(mapped.map(node => [node.key, node])).values()];
      if (!placementsFound.length) {
        const current = this.snapshot.files.find(current => current.path === file.path), baseline = owned.find(current => current.path === file.path);
        if (current && (!baseline || hash(current.bytes) !== baseline.hash)) this.problems.push(javaProblem('output-conflict', 'Existing native source needs an explicit matching root association.', file.path));
        else comparisons.set(file.path, file.generated);
        continue;
      }
      if (placementsFound.length !== 1 || roots.length !== 1) { this.problems.push(javaProblem('ambiguous-native-symbol', 'Native ownership requires one exact containing declaration.', file.path)); continue; }
      const old = placementsFound[0]!, next = roots[0]!;
      if (old.type !== next.type) {
        const baseline = owned.find(record => record.path === old.file), current = this.snapshot.files.find(record => record.path === old.file);
        if (!baseline || baseline.adopted?.length || !current || hash(current.bytes) !== baseline.hash
          || this.snapshot.files.some(record => record.path === file.path && record.path !== old.file))
          this.problems.push(javaProblem('implemented-move', 'A native type move requires an untouched generated source and an unoccupied destination.', old.file, old.start, old.length));
        else { removed.add(old.file); comparisons.set(file.path, file.generated); placements.set(file.path, file.path); }
        continue;
      }
      placements.set(file.path, old.file);
      const list = edits.get(old.file) ?? [];
      list.push({ node: old, content: file.generated.slice(next.nodeStart, next.nodeStart + next.nodeLength) }); edits.set(old.file, list);
    }
    for (const [file, replacements] of edits) {
      let source = text(this.snapshot, file), end = source.length;
      for (const { node, content } of replacements.sort((a, b) => b.node.nodeStart - a.node.nodeStart)) {
        if (node.nodeStart + node.nodeLength > end) { this.problems.push(javaProblem('ambiguous-native-symbol', 'Native ownership overlaps another selected declaration.', file, node.start)); break; }
        source = source.slice(0, node.nodeStart) + content + source.slice(node.nodeStart + node.nodeLength); end = node.nodeStart;
      }
      comparisons.set(file, source);
    }
    if (this.problems.length) return { facts: rendered.facts, placements, comparisons };
    const expected = await analyzeJava(replaceFiles({ ...this.snapshot, files: this.snapshot.files.filter(file => !removed.has(file.path)) }, comparisons), this.configFile);
    const declarations = expected.facts.declarations.filter(node => desired.some(file => file.artifacts.some(item => item.locator.format === 'java-symbol-1' && address(item).type === node.type)));
    this.problems.push(...expected.problems.filter(problem => !problem.code.startsWith('java-') || problem.at.kind === 'dependency'
      && declarations.some(node => problem.at.kind === 'dependency' && problem.at.path[1] === node.file && typeof problem.at.path[2] === 'number'
        && problem.at.path[2] >= node.nodeStart && problem.at.path[2] < node.nodeStart + node.nodeLength)));
    return { facts: expected.facts, placements, comparisons };
  }

}

