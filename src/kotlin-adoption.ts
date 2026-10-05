import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation } from './specification-identity.js';
import type { KotlinFile } from './kotlin-declarations.js';
import { canonical, success } from './identity-baseline.js';
import { problem } from './project-files.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';
import { compareKotlin } from './kotlin-comparison.js';

type Declaration = KotlinQuery['declarations'][number];
const address = (node: Declaration) => canonical({ file: node.file, declaration: node.selector });
const signature = (node: Declaration) => canonical({ kind: node.kind, selector: node.selector, packageName: node.packageName,
  visibility: node.visibility, returnType: node.returnType, typeParameters: node.typeParameters, parameterNames: node.parameterNames, mutable: node.mutable });

/** Explicit associations identify existing implementations; native facts establish contract compatibility. */
export async function adoptKotlin(snapshot: ProjectSnapshot, files: readonly KotlinFile[], associations: readonly ArtifactAssociation[], packageName: string): Promise<Check<KotlinFile[]>> {
  const current = await queryKotlin(snapshot, 'expec.kotlin.json');
  if (!current.value || current.problems.length) return { problems: current.problems, deferred: [] };
  const owned = associations.filter(item => item.locator.outputId === 'kotlin' && files.some(file => file.artifacts.some(expected => expected.specId === item.specId)));
  files = files.map(file => {
    const paths = new Set(owned.filter(item => item.specId === file.id && item.locator.format === 'kotlin-symbol-1'
      && (item.locator.value as { declaration: unknown[] }).declaration.length === 1).map(item => (item.locator.value as { file: string }).file));
    if (paths.size !== 1) return file;
    const path = [...paths][0]!;
    return { ...file, path, artifacts: file.artifacts.map(item => ({ ...item, locator: { ...item.locator, value: { ...item.locator.value as { file: string }, file: path } } })) };
  });
  for (const file of files) for (const contract of file.artifacts.filter(item => item.locator.format === 'kotlin-symbol-1')) {
    const selector = (contract.locator.value as { declaration: unknown[] }).declaration;
    if (selector.length === 1 && !owned.some(item => item.specId === contract.specId) && current.value.declarations.some(node => node.packageName === packageName && node.selector.length === 1
      && canonical(node.selector) === canonical(selector))) return { problems: [problem(snapshot.root, 'unowned-declaration', file.path, 'Existing Kotlin declarations require explicit associations.')], deferred: [] };
  }
  const expected = await compareKotlin(snapshot, current.value, files, owned);
  if (!expected.value || expected.problems.length) return { problems: expected.problems, deferred: [] };
  const problems = [], adopted: KotlinFile[] = [], claimed = new Set<string>();
  for (const file of files) {
    const root = expected.value.native.declarations.find(node => node.file === file.path && node.selector.length === 1);
    const supplied = associations.filter(item => item.locator.outputId === 'kotlin' && file.artifacts.some(expected => expected.specId === item.specId));
    if (!supplied.length) {
      if (root && current.value.declarations.some(node => node.packageName === root.packageName && canonical(node.selector) === canonical(root.selector))) {
        problems.push(problem(snapshot.root, 'unowned-declaration', file.path, 'Existing Kotlin declarations require complete explicit associations.'));
      }
      adopted.push(file); continue;
    }
    const selected: ArtifactAssociation[] = [];
    for (const contract of file.artifacts) {
      const wanted = expected.value.native.declarations.find(node => address(node) === canonical(contract.locator.value));
      let matches = supplied.filter(item => item.specId === contract.specId && item.locator.format === 'kotlin-symbol-1')
        .flatMap(item => current.value!.declarations.filter(node => address(node) === canonical(item.locator.value)).map(node => ({ item, node })));
      if (wanted && !matches.length && ['parameter', 'type-parameter'].includes(wanted.kind) && !supplied.some(item => item.specId === contract.specId)) {
        const parent = canonical({ file: wanted.file, declaration: wanted.selector.slice(0, -1) });
        if (selected.some(item => canonical(item.locator.value) === parent)) {
          matches = current.value.declarations.filter(node => address(node) === canonical(contract.locator.value)).map(node => ({ item: contract, node }));
        }
      }
      if (!wanted || matches.length !== 1) {
        problems.push(problem(snapshot.root, 'unowned-declaration', file.path, 'Each adopted contract needs one actual native declaration.')); continue;
      }
      const { item, node } = matches[0]!, key = address(node);
      if (wanted.hasDefault && !node.hasDefault || claimed.has(key) || signature(node) !== signature(wanted) || wanted.zeroArgumentConstruction && !node.zeroArgumentConstruction) {
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
