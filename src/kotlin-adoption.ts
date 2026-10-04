import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation } from './specification-identity.js';
import type { KotlinFile } from './kotlin-declarations.js';
import { canonical, success } from './identity-baseline.js';
import { hash, problem } from './project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

type Declaration = KotlinQuery['declarations'][number];
const address = (node: Declaration) => canonical({ file: node.file, declaration: node.selector });
const signature = (node: Declaration) => canonical({ kind: node.kind, selector: node.selector, packageName: node.packageName,
  visibility: node.visibility, returnType: node.returnType, typeParameters: node.typeParameters, mutable: node.mutable });

/** Explicit associations identify existing implementations; native facts establish contract compatibility. */
export async function adoptKotlin(snapshot: ProjectSnapshot, files: readonly KotlinFile[], associations: readonly ArtifactAssociation[]): Promise<Check<KotlinFile[]>> {
  const current = await queryKotlin(snapshot, 'expec.kotlin.json');
  if (!current.value || current.problems.length) return { problems: current.problems, deferred: [] };
  const expected = await queryKotlin({ ...snapshot, files: [...snapshot.files.filter(file => !file.path.endsWith('.kt')),
    ...files.map(file => ({ path: file.path, bytes: Buffer.from(file.text), version: hash(Buffer.from(file.text)) }))] }, 'expec.kotlin.json');
  if (!expected.value || expected.problems.length) return { problems: expected.problems, deferred: [] };
  const problems = [], adopted: KotlinFile[] = [], claimed = new Set<string>();
  for (const file of files) {
    const root = expected.value.declarations.find(node => node.file === file.path && node.selector.length === 1);
    const supplied = associations.filter(item => item.locator.outputId === 'kotlin' && file.artifacts.some(expected => expected.specId === item.specId));
    if (!supplied.length) {
      if (root && current.value.declarations.some(node => node.packageName === root.packageName && canonical(node.selector) === canonical(root.selector))) {
        problems.push(problem(snapshot.root, 'unowned-declaration', file.path, 'Existing Kotlin declarations require complete explicit associations.'));
      }
      adopted.push(file); continue;
    }
    const selected: ArtifactAssociation[] = [];
    for (const contract of file.artifacts) {
      const wanted = expected.value.declarations.find(node => address(node) === canonical(contract.locator.value));
      const matches = supplied.filter(item => item.specId === contract.specId && item.locator.format === 'kotlin-symbol-1')
        .flatMap(item => current.value!.declarations.filter(node => address(node) === canonical(item.locator.value)).map(node => ({ item, node })));
      if (!wanted || matches.length !== 1) {
        problems.push(problem(snapshot.root, 'unowned-declaration', file.path, 'Each adopted contract needs one actual native declaration.')); continue;
      }
      const { item, node } = matches[0]!, key = address(node);
      if (claimed.has(key) || signature(node) !== signature(wanted) || wanted.zeroArgumentConstruction && !node.zeroArgumentConstruction) {
        problems.push(problem(snapshot.root, 'native-signature-conflict', node.file, 'The selected native declaration is already claimed or does not satisfy the contract.')); continue;
      }
      claimed.add(key); selected.push(item);
    }
    const paths = new Set(selected.map(item => (item.locator.value as { file: string }).file));
    if (paths.size !== 1) problems.push(problem(snapshot.root, 'unowned-declaration', file.path, 'An adopted top-level declaration and its members must share one native file.'));
    else adopted.push({ ...file, path: [...paths][0]!, artifacts: selected, adopted: true });
  }
  return problems.length ? { problems, deferred: [] } : success(adopted);
}
