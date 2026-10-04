import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation } from './specification-identity.js';
import { canonical } from './identity-baseline.js';
import { hash, problem } from './project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

type Baseline = { path: string; generated: string; artifacts: readonly ArtifactAssociation[] };

/** Owned expectations stay intact while unowned neighboring methods and driver implementations remain editable. */
export async function checkKotlinTests(snapshot: ProjectSnapshot, current: KotlinQuery, files: readonly Baseline[], driver: string): Promise<Check> {
  const changed = files.filter(file => file.path !== driver && snapshot.files.some(actual => actual.path === file.path && actual.version !== hash(Buffer.from(file.generated))));
  if (!changed.length) return { problems: [], deferred: [] };
  // Only PSI syntax ranges from this baseline view are used. Current code is checked again before a write.
  const baseline = await queryKotlin({ ...snapshot, files: [...snapshot.files.filter(file => !files.some(before => before.path === file.path)),
    ...files.map(file => ({ path: file.path, bytes: Buffer.from(file.generated), version: hash(Buffer.from(file.generated)) }))] }, 'expec.kotlin.json');
  if (!baseline.value) return { problems: baseline.problems, deferred: baseline.deferred };
  const problems = [];
  for (const file of changed) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.files.find(actual => actual.path === file.path)!.bytes);
    const declarations = [...baseline.value.declarations.filter(node => node.file === file.path && node.kind === 'class' && node.selector.length === 1), ...file.artifacts.filter(item => item.locator.format === 'kotlin-symbol-1').flatMap(item =>
      baseline.value!.declarations.filter(node => canonical({ file: node.file, declaration: node.selector }) === canonical(item.locator.value)
        && ['function', 'property'].includes(node.kind)))];
    const contract = (node: KotlinQuery['declarations'][number], source: string) => source.slice(node.range.start, node.kind === 'class' ? node.bodyRange?.start ?? node.range.end : node.range.end);
    if (!declarations.length || declarations.some(before => {
      const after = current.declarations.find(node => node.file === file.path && canonical(node.selector) === canonical(before.selector));
      return !after || contract(before, file.generated) !== contract(after, text);
    })) problems.push(problem(snapshot.root, 'output-conflict', file.path, 'An owned test expectation or DSL definition changed; preserve it before updating the generated contract.'));
  }
  return { problems, deferred: [] };
}
