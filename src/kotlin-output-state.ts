import { z } from 'zod';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { OutputContext } from './output.js';
import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { KotlinQuery } from './kotlin-query.js';
import { KotlinProject } from './kotlin-project.js';
import { KotlinDeclarations, kotlinOptions, type KotlinCarrier } from './kotlin-declarations.js';
import { kotlinTuple } from './kotlin-tuples.js';
import { canonical, identifier, locatorSchema, success } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { readJson } from './json-data.js';
import { outputProblem } from './output-documents.js';

export const kotlinStatePath = '.expec/outputs/' + Buffer.from('kotlin').toString('hex') + '.json';
const state = z.strictObject({ format: z.literal(1), options: z.string(), deleted: z.array(identifier).default([]), subjects: z.array(identifier),
  mappings: z.array(z.strictObject({ id: identifier, kind: z.enum(['name', 'import']), name: z.string(), as: z.string().optional() })), files: z.array(z.strictObject({
  adopted: z.boolean().optional(), documentation: z.array(identifier).optional(), id: identifier, path: z.string().refine(literal), generated: z.string(), hash: z.string(),
  artifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })),
})) });

export type KotlinOutputState = z.infer<typeof state>;
export type KotlinDataCarrier = KotlinCarrier & { readonly target: KotlinQuery['declarations'][number]; readonly trusted: boolean };

/** Generated companions have their own native role; current syntax, not a file hash, proves data purity. */
export function kotlinDataCarriers(snapshot: ProjectSnapshot, current: IdentifiedSpecification, native: KotlinQuery, context?: OutputContext): Check<{
  carriers: readonly KotlinDataCarrier[]; companions: ReadonlySet<string>;
}> {
  const stored = kotlinState(snapshot);
  if (stored.problems.length) return { problems: stored.problems, deferred: [] };
  if (!stored.value) return success({ carriers: [], companions: new Set() });
  const declarations = new KotlinDeclarations(current, kotlinOptions.parse(JSON.parse(stored.value.options)), context), files = declarations.render();
  if (declarations.problems.length) return { problems: declarations.problems, deferred: [] };
  const recorded = (artifact: KotlinCarrier['artifact']) => {
    const file = files.find(file => file.artifacts.some(item => canonical(item) === canonical(artifact)));
    return file && stored.value!.files.some(before => !before.adopted && before.id === file.id && before.path === file.path
      && before.generated === file.text && before.artifacts.some(item => canonical(item) === canonical(artifact)));
  };
  const companions = new Set(declarations.companions.filter(recorded).map(item => canonical(item))), carriers: KotlinDataCarrier[] = [];
  for (const carrier of declarations.carriers) {
    if (!companions.has(canonical(carrier.artifact))) continue;
    const matches = native.declarations.filter(node => canonical({ file: node.file, declaration: node.selector }) === canonical(carrier.artifact.locator.value));
    if (matches.length !== 1) continue;
    const target = matches[0]!, actual = snapshot.files.find(file => file.path === target.file);
    const text = actual && new TextDecoder('utf-8', { fatal: true }).decode(actual.bytes);
    carriers.push({ ...carrier, target, trusted: text?.slice(target.range.start, target.range.end) === carrier.text });
  }
  return success({ carriers, companions });
}

export function kotlinState(snapshot: ProjectSnapshot): Check<KotlinOutputState> {
  const source = snapshot.files.find(file => file.path === kotlinStatePath);
  if (!source) return { problems: [], deferred: [] };
  try {
    const parse = (text: string) => readJson(text, (_code, message) => { throw new Error(message); });
    const stored = state.parse(parse(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes)));
    kotlinOptions.parse(parse(stored.options));
    if (stored.files.some(file => hash(Buffer.from(file.generated)) !== file.hash || Buffer.from(file.generated).toString('utf8') !== file.generated
      || file.documentation && (!file.adopted || new Set(file.documentation).size !== file.documentation.length || file.documentation.some(id => !file.artifacts.some(item => item.specId === id)))
      || file.artifacts.some(item => item.locator.outputId !== 'kotlin' || (item.locator.value as { file: string }).file !== file.path))) throw new Error('Invalid generated Kotlin baseline.');
    new KotlinProject({ outputId: 'kotlin' }, stored.files.flatMap(file => file.artifacts));
    return success(stored);
  } catch { return { problems: [outputProblem('invalid-output-state', kotlinStatePath, 'Recorded Kotlin text, options or associations are invalid.')], deferred: [] }; }
}

/** Only unchanged generated tuple support supplies trusted construction/accessors. */
export function kotlinTupleTypes(snapshot: ProjectSnapshot, native: KotlinQuery): Check<ReadonlyMap<number, string | undefined>> {
  const stored = kotlinState(snapshot);
  if (stored.problems.length) return { problems: stored.problems, deferred: [] };
  const tuples = new Map<number, string | undefined>();
  if (!stored.value) return success(tuples);
  const options = kotlinOptions.parse(JSON.parse(stored.value.options));
  for (const file of stored.value.files) {
    const match = /\/Tuple([1-9][0-9]*)\.kt$/.exec(file.path);
    if (!match) continue;
    const arity = Number(match[1]), expected = kotlinTuple(options.package, arity);
    if (file.generated !== expected) continue;
    const matches = native.declarations.filter(item => item.file === file.path && item.kind === 'class' && item.selector.length === 1 && item.name === 'Tuple' + arity && item.packageName === options.package);
    const current = snapshot.files.find(item => item.path === file.path);
    tuples.set(arity, current?.version === hash(Buffer.from(expected)) && Buffer.from(current.bytes).equals(Buffer.from(expected)) && matches.length === 1 && matches[0]!.dataConstruction
      ? options.package + '.Tuple' + arity : undefined);
  }
  return success(tuples);
}

/** Construction of a generated restriction is trusted only while its actual bytes match this contract. */
export function kotlinGeneratedFiles(snapshot: ProjectSnapshot, current: IdentifiedSpecification, context?: OutputContext): Check<ReadonlySet<string>> {
  const stored = kotlinState(snapshot);
  if (stored.problems.length) return { problems: stored.problems, deferred: [] };
  if (!stored.value) return success(new Set());
  const declarations = new KotlinDeclarations(current, kotlinOptions.parse(JSON.parse(stored.value.options)), context);
  const files = declarations.render();
  if (declarations.problems.length) return { problems: declarations.problems, deferred: [] };
  return success(new Set(files.filter(file => {
    const recorded = stored.value!.files.find(before => before.id === file.id && before.path === file.path && !before.adopted);
    const actual = snapshot.files.find(actual => actual.path === file.path);
    return recorded?.generated === file.text && actual && Buffer.from(actual.bytes).equals(Buffer.from(file.text));
  }).map(file => file.path)));
}
