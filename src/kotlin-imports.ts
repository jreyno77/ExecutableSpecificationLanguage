import type { Check, Diagnostic } from './checking.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { ProjectSnapshot } from './project-connection.js';
import { kotlinConfiguration } from './kotlin-configuration.js';
import { queryKotlin } from './kotlin-query.js';
import { hash } from './project-files.js';

/** Proves each mapped declaration with native type parameters, including currently unused mappings. */
export async function checkKotlinImports(current: IdentifiedSpecification, snapshot: ProjectSnapshot, directory: string,
  mappings: readonly { id: string; name: string }[]): Promise<Check> {
  if (!mappings.length) return { problems: [], deferred: [] };
  const configured = kotlinConfiguration(snapshot, 'expec.kotlin.json');
  if (!configured.value) return { problems: configured.problems, deferred: configured.deferred };
  const problems: Diagnostic[] = [];
  const finding = (id: string, message: string) => problems.push({ code: 'incompatible-native-import',
    at: current.specification.inspection.read(current.node(id)).origin, message, related: [] });
  const roots = [...configured.value.sourceRoots.main, ...configured.value.sourceRoots.test];
  if (!roots.some(root => directory === root || directory.startsWith(root + '/'))
    || directory.split('/').some(part => snapshot.excludeNames.includes(part))
    || snapshot.excluded.some(path => directory === path || directory.startsWith(path + '/'))) {
    finding(mappings[0]!.id, 'Native import proof requires an included output directory in a configured Kotlin source set.');
    return { problems, deferred: [] };
  }
  const occupied = new Set(snapshot.files.map(file => file.path.toLowerCase()));
  let sequence = 0;
  const proofs = mappings.map(mapping => {
    const item = current.specification.inspection.read(current.node(mapping.id));
    const parameters = 'typeParameters' in item ? item.typeParameters.map((_, index) => '_ExpecT' + index) : [];
    let name: string, path: string;
    do { name = '__expec_import_' + sequence++ + '.kt'; path = directory + '/' + name; }
    while (occupied.has(path.toLowerCase()) || snapshot.excludeNames.includes(name) || snapshot.excluded.includes(path));
    occupied.add(path.toLowerCase());
    const generic = parameters.length ? '<' + parameters.join(', ') + '>' : '';
    const bytes = Buffer.from('package expec_import_proof\nprivate fun ' + generic + ' ' + name.slice(0, -3) + '(value: ' + mapping.name + generic + '): kotlin.Unit {}\n');
    return { ...mapping, file: { path, bytes, version: hash(bytes) } };
  });
  const checked = await queryKotlin({ ...snapshot, files: [...snapshot.files, ...proofs.map(proof => proof.file)] }, 'expec.kotlin.json');
  if (!checked.value) return { problems: checked.problems, deferred: checked.deferred };
  for (const proof of proofs) {
    if (!checked.value.files.includes(proof.file.path)) finding(proof.id, 'Native analysis did not inspect the supplied import proof.');
    for (const issue of checked.value.problems.filter(issue => issue.file === proof.file.path))
      finding(proof.id, 'Native type ' + proof.name + ' does not satisfy its declared mapping: ' + issue.message);
  }
  return { problems, deferred: [] };
}
