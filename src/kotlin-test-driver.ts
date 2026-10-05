import type { ArtifactAssociation, ArtifactLocator, IdentifiedSpecification } from './specification-identity.js';
import type { NodeId } from './model.js';
import type { Check } from './checking.js';
import type { KotlinFile } from './kotlin-declarations.js';
import type { KotlinQuery } from './kotlin-query.js';
import { canonical } from './identity-baseline.js';

type Declaration = KotlinQuery['declarations'][number];
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Explicit native operation bindings never grant edit ownership of the selected class. */
export function kotlinDriver(native: KotlinQuery, locator: ArtifactLocator): Declaration | undefined {
  if (locator.format !== 'kotlin-symbol-1') return undefined;
  const found = native.declarations.filter(node => node.kind === 'class' && !node.synthetic
    && same(locator.value, { file: node.file, declaration: node.selector }));
  return found.length === 1 ? found[0] : undefined;
}
export function kotlinDriverBindings(current: IdentifiedSpecification,
  targets: ReadonlyMap<NodeId, Declaration>): Check<ArtifactAssociation[]> {
  const value: ArtifactAssociation[] = [], problems = [];
  for (const [id, target] of targets) {
    const operation = current.specification.inspection.read(id);
    if (!['setup', 'action', 'observation', 'check'].includes(operation.kind)) continue;
    if (!('body' in operation) || operation.body.kind === 'available' || target.kind !== 'function'
      || !['public', 'internal'].includes(target.visibility)) {
      problems.push({ code: 'native-signature-conflict', at: operation.origin, message: 'Select an accessible method on this driver for a bodyless operation.', related: [] }); continue;
    }
    value.push({ specId: current.id(id), locator: { outputId: 'kotlin-acceptance', format: 'kotlin-symbol-1', value: { file: target.file, declaration: target.selector.map(({ kind, name, parameters, receiver }) => ({ kind, name, ...parameters ? { parameters } : {}, ...receiver ? { receiver } : {} })) } } });
  }
  return { ...problems.length ? {} : { value }, problems, deferred: [] };
}
export function checkKotlinDriver(current: IdentifiedSpecification, native: KotlinQuery, adapter: KotlinFile,
  bindings: readonly ArtifactAssociation[]): Check {
  const problems = [];
  for (const binding of bindings) {
    const planned = adapter.artifacts.find(item => item.specId === binding.specId && item.locator.format === 'kotlin-symbol-1');
    const find = (locator: ArtifactLocator | undefined) => native.declarations.filter(node => same(locator?.value, { file: node.file, declaration: node.selector }));
    const actual = find(binding.locator), expected = find(planned?.locator);
    if (actual.length !== 1 || expected.length !== 1 || actual[0]!.returnType !== expected[0]!.returnType
      || !same(actual[0]!.parameterNames, expected[0]!.parameterNames)
      || !same(actual[0]!.selector.at(-1)!.parameters, expected[0]!.selector.at(-1)!.parameters)
      || !same(actual[0]!.typeParameters ?? [], expected[0]!.typeParameters ?? [])
      || !native.references.some(reference => reference.file === adapter.path && same(reference.owner, expected[0]!.selector)
        && reference.targetFile === actual[0]!.file && same(reference.target, actual[0]!.selector) && reference.role === 'call')) {
      problems.push({ code: 'native-signature-conflict', at: current.specification.inspection.read(current.node(binding.specId)).origin,
        message: 'The selected native method must match the checked operation signature.', related: [] });
    }
  }
  return { problems, deferred: [] };
}
