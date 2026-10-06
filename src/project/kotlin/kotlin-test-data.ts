import type { Check } from '../../compiler/checking.js';
import type { OutputContext } from '../output/output.js';
import type { NodeId } from '../../model/model.js';
import type { Item } from '../../model/inspection-item.js';
import type { TypeId } from '../../compiler/types.js';
import type { IdentifiedSpecification } from '../../model/specification-identity.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { KotlinTestOptions } from './kotlin-examples.js';
import type { KotlinDataCarrier } from './kotlin-output-state.js';
import { KotlinDeclarations, kotlinOptions, type KotlinFile } from './kotlin-declarations.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';
import { canonical, success } from '../../model/identity-baseline.js';
import { hash, problem } from '../connection/project-files.js';

/** Reuses contract representations for test annotations and proves their proposed native declarations. */
export async function kotlinTestData(current: IdentifiedSpecification, options: KotlinTestOptions, names: readonly { id: string; name: string }[],
  targets: ReadonlyMap<NodeId, KotlinQuery['declarations'][number]>, tuples: ReadonlyMap<number, string | undefined>, snapshot: ProjectSnapshot,
  context?: OutputContext): Promise<Check<{ files: readonly KotlinFile[]; carriers: readonly KotlinDataCarrier[]; tuples: ReadonlyMap<number, string | undefined> }>> {
  const inspection = current.specification.inspection, types = current.specification.types;
  const modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
  const owned = (item: Item) => item.origin.kind === 'source' && modules.has(item.origin.module);
  const operations = [...inspection.query('setup'), ...inspection.query('action'), ...inspection.query('observation'), ...inspection.query('check')].filter(owned);
  const entries: { owner: Item; type: TypeId }[] = [...inspection.query('fixture')].filter(owned).flatMap(owner => {
    const fact = types.typeOf(owner.declaredType.id); return fact.status === 'known' ? [{ owner, type: fact.value }] : [];
  });
  for (const owner of operations) {
    const signature = types.callable(owner.id);
    for (const parameter of signature.parameters) if (parameter.type.status === 'known') entries.push({ owner: inspection.read(parameter.declaration), type: parameter.type.value });
    if (signature.result.status === 'known' && signature.result.value.kind === 'value') entries.push({ owner, type: signature.result.value.type });
  }
  const renderer = new KotlinDeclarations(current, kotlinOptions.parse({ directory: options.testRoot, package: options.package + '.dsl' }), context);
  const tupleNames = new Map([...tuples].flatMap(([arity, name]) => name ? [[arity, name] as const] : []));
  const files = renderer.renderData(entries, new Map(names.map(item => [current.node(item.id), item.name])),
    new Map([...targets].map(([id, target]) => [id, target.packageName + '.' + target.selector.map(item => item.name).join('.')])), tupleNames);
  if (renderer.problems.length) return { problems: renderer.problems, deferred: [] };
  if (!files.length) return success({ files, carriers: [], tuples });
  const proposed = new Map(snapshot.files.map(file => [file.path, file]));
  for (const file of files) { const bytes = Buffer.from(file.text); proposed.set(file.path, { path: file.path, bytes, version: hash(bytes) }); }
  const native = await queryKotlin({ ...snapshot, files: [...proposed.values()] }, 'expec.kotlin.json');
  if (!native.value) return { problems: native.problems, deferred: native.deferred };
  const findings = native.value.problems.filter(issue => files.some(file => file.path === issue.file));
  if (findings.length) return { problems: findings.map(issue => problem(snapshot.root, 'kotlin-' + issue.code, issue.file, issue.message)), deferred: [] };
  const carriers: KotlinDataCarrier[] = [];
  for (const carrier of renderer.carriers) {
    const selected = native.value.declarations.filter(node => canonical({ file: node.file, declaration: node.selector }) === canonical(carrier.artifact.locator.value));
    const target = selected.length === 1 ? selected[0] : undefined, file = target && files.find(file => file.path === target.file);
    if (!target || file?.text.slice(target.range.start, target.range.end) !== carrier.text) return {
      problems: [problem(snapshot.root, 'native-definition-unavailable', file?.path ?? '', 'A proposed test carrier requires one exact native declaration.')], deferred: [] };
    carriers.push({ ...carrier, target, trusted: true });
  }
  const available = new Map(tuples);
  for (const file of files) if (file.id.startsWith('support:tuple:')) available.set(Number(file.id.slice('support:tuple:'.length)), options.package + '.dsl.Tuple' + file.id.slice('support:tuple:'.length));
  return success({ files, carriers, tuples: available });
}
