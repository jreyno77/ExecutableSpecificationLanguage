import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation } from './specification-identity.js';
import type { KotlinFile } from './kotlin-declarations.js';
import { canonical, success } from './identity-baseline.js';
import { hash, problem } from './project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

/** Compares contracts in the real native neighborhood, retaining unowned declarations and imports. */
export async function compareKotlin(snapshot: ProjectSnapshot, current: KotlinQuery, files: readonly KotlinFile[], owned: readonly ArtifactAssociation[]): Promise<Check<{ native: KotlinQuery; sources: ReadonlyMap<string, string> }>> {
  const captured = new Map(snapshot.files.map(file => [file.path, file]));
  const text = (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(snapshot.files.find(file => file.path === path)!.bytes);
  const roots = current.declarations.filter(node => node.selector.length === 1);
  const selected = roots.filter(node => owned.some(item => item.locator.outputId === 'kotlin' && item.locator.format === 'kotlin-symbol-1'
    && canonical(item.locator.value) === canonical({ file: node.file, declaration: node.selector })));
  // The first native pass supplies syntax spans only. Missing provider types here are not accepted semantic facts.
  const inputs = files.map((file, index) => ({ ...file, temporary: file.path.slice(0, file.path.lastIndexOf('/') + 1) + '__expec_comparison_' + index + '.kt' }));
  const templates = await queryKotlin({ ...snapshot, files: [...snapshot.files.filter(file => !current.files.includes(file.path)),
    ...inputs.map(file => ({ path: file.temporary, bytes: Buffer.from(file.text), version: hash(Buffer.from(file.text)) }))] }, 'expec.kotlin.json');
  if (!templates.value) return { problems: templates.problems, deferred: templates.deferred };
  for (const path of new Set(selected.map(node => node.file))) {
    let retained = text(path);
    for (const node of selected.filter(node => node.file === path).sort((a, b) => b.range.start - a.range.start)) retained = retained.slice(0, node.range.start) + retained.slice(node.range.end);
    const bytes = Buffer.from(retained); captured.set(path, { path, bytes, version: hash(bytes) });
  }
  for (const path of new Set(files.map(file => file.path))) {
    const parts = inputs.filter(file => file.path === path);
    const generated = parts.flatMap(file => templates.value!.declarations.filter(node => node.file === file.temporary && node.selector.length === 1)
      .map(node => ({ node, text: file.text.slice(node.range.start, node.range.end) })));
    const imports = [...parts.flatMap(file => templates.value!.imports.filter(item => item.file === file.temporary).map(item => file.text.slice(item.range.start, item.range.end))),
      ...current.imports.filter(item => item.file === path).map(item => text(item.file).slice(item.range.start, item.range.end))];
    const unowned = roots.filter(node => node.file === path && !selected.includes(node));
    // Native PSI partitions each template; the combined comparison retains every owner of a shared file.
    const source = snapshot.files.find(source => source.path === path);
    const original = source && new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
    const content = 'package ' + (generated[0]?.node.packageName ?? '') + '\n\n' + [...new Set(imports)].join('\n') + '\n\n'
      + generated.map(part => part.text).join('\n\n') + '\n\n'
      + unowned.map(node => original!.slice(node.range.start, node.range.end)).join('\n\n') + '\n';
    const bytes = Buffer.from(content); captured.set(path, { path, bytes, version: hash(bytes) });
  }
  const compared = await queryKotlin({ ...snapshot, files: [...captured.values()] }, 'expec.kotlin.json');
  if (!compared.value) return { problems: compared.problems, deferred: compared.deferred };
  const wanted = new Set(files.map(file => file.path));
  const retained = compared.value.declarations.filter(node => node.selector.length === 1 && roots.some(before => !selected.includes(before)
    && before.file === node.file && canonical(before.selector) === canonical(node.selector)));
  // Old callers may disagree with a new signature; they are checked after the actual preservation edits.
  const failures = compared.value.problems.filter(issue => wanted.has(issue.file) && !retained.some(node => node.file === issue.file
    && node.range.start <= issue.range.start && node.range.end >= issue.range.end));
  return failures.length ? { problems: failures.map(issue => problem(snapshot.root, 'kotlin-' + issue.code, issue.file, issue.message)), deferred: [] }
    : success({ native: compared.value, sources: new Map(compared.value.files.map(path => [path, new TextDecoder('utf-8', { fatal: true }).decode(captured.get(path)!.bytes)])) });
}
