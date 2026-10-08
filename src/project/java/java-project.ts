import type { ArtifactAssociation, SpecIdentifier } from '../../model/specification-identity.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ProjectRead, ProjectSearch } from '../connection/project-inspection.js';
import { z } from 'zod';
import { canonical, identifier, jsonData, locatorSchema } from '../../model/identity-baseline.js';
import { literal } from '../connection/project-files.js';
import { callerOptions, javaProblem, javaQueryOptions, requireJava } from './java-settings.js';
import { JavaAnalysis, javaSymbol, type JavaFacts } from './java-analysis.js';

/** Native Java queries over one supplied project capture. */
export class JavaProject {
  private readonly options: { outputId: string; configFile?: string };
  private readonly associations: readonly ArtifactAssociation[];
  private readonly analysis: JavaAnalysis;
  constructor(options: { outputId: string; configFile?: string }, associations: readonly ArtifactAssociation[]) {
    callerOptions(javaQueryOptions, options);
    requireJava(jsonData(associations) && z.array(z.strictObject({ specId: identifier, locator: locatorSchema })).safeParse(associations).success, 'Provide finite artifact associations.');
    requireJava(new Set(associations.map(item => canonical(item.locator))).size === associations.length, 'Duplicate Java artifact locator.');
    const selected = associations.filter(item => item.locator.outputId === options.outputId);
    for (const { locator } of selected) {
      if (locator.format === 'java-symbol-1') requireJava(javaSymbol.safeParse(locator.value).success, 'Provide an exact Java native type/member selector.');
      if (locator.format === 'java-file-1') requireJava(z.strictObject({ file: z.string().refine(literal), version: z.string() }).safeParse(locator.value).success, 'Provide a captured Java companion-file locator.');
      if (locator.format === 'java-alias-1') requireJava(z.strictObject({ file: z.string().refine(literal), alias: identifier, start: z.number().int().nonnegative(), length: z.number().int().positive() }).safeParse(locator.value).success, 'Provide an exact alias documentation span.');
    }
    this.options = structuredClone(options); this.associations = structuredClone(selected);
    this.analysis = new JavaAnalysis(this.options.configFile ?? 'expec.java.json', 'reader');
  }
  private async query(id: SpecIdentifier, supplied: ProjectSnapshot) {
    requireJava(identifier.safeParse(id).success && supplied && Array.isArray(supplied.files), 'Provide a subject and captured project.');
    const snapshot = structuredClone(supplied), { facts, problems, scope: sourceScope } = await this.analysis.read(snapshot);
    const claimed = new Map<string, string>(), definitions = new Map<string, JavaFacts['declarations']>();
    for (const association of this.associations) {
      if (association.locator.format !== 'java-symbol-1') continue;
      const selector = association.locator.value as z.infer<typeof javaSymbol>;
      const found = facts.declarations.filter(item => item.file === selector.file && item.type === selector.type && canonical(item.member) === canonical(selector.member) && item.parameter === selector.parameter);
      if (found.length !== 1) problems.push(javaProblem(found.length ? 'ambiguous-native-symbol' : 'missing-native-symbol', 'Select exactly one native Java declaration.', selector.file));
      else {
        const node = found[0]!, previous = claimed.get(node.key);
        if (previous && previous !== association.specId) problems.push(javaProblem('ambiguous-native-symbol', 'A native symbol is claimed by more than one identity.', node.file, node.start));
        claimed.set(node.key, association.specId); definitions.set(association.specId, [...definitions.get(association.specId) ?? [], node]);
      }
    }
    const associated = this.associations.filter(item => item.specId === id);
    if (!associated.length) problems.push(javaProblem('mapping-not-found', 'No Java artifact mapping exists for this subject.', '<associations>'));
    for (const { locator } of associated) {
      if (!['java-symbol-1', 'java-file-1', 'java-alias-1'].includes(locator.format)) problems.push(javaProblem('unsupported-project-locator', 'This association is not a supported native Java definition.', '<associations>'));
      else if (!snapshot.files.some(file => file.path === (locator.value as { file: string }).file)) problems.push(javaProblem('missing-project-artifact', 'Associated captured Java source is absent.', (locator.value as { file: string }).file));
    }
    const scope = [...snapshot.files.filter(file => sourceScope.includes(file.path)).map(file => ({ outputId: this.options.outputId, format: 'java-file-1', value: { file: file.path, version: file.version } })),
      ...(snapshot.nativeInputs ?? []).map(value => ({ outputId: this.options.outputId, format: 'native-input-1', value: { ...value } }))];
    const coverage = { scope, complete: !problems.length, limitations: problems.map(problem => problem.message) };
    if (facts.unresolved.length) { coverage.complete = false; coverage.limitations.push('Some captured Java names have no native binding.'); }
    return { snapshot, facts, problems, definitions, claimed, associated, coverage };
  }
  async read(id: SpecIdentifier, snapshot: ProjectSnapshot): Promise<ProjectRead> {
    const query = await this.query(id, snapshot);
    const artifacts = query.associated.flatMap(({ locator: at }) => {
      const path = (at.value as { file?: string }).file, file = query.snapshot.files.find(file => file.path === path);
      return file ? [{ at, file }] : [];
    });
    return structuredClone({ artifacts, coverage: query.coverage, problems: query.problems });
  }
  async search(subject: SpecIdentifier, snapshot: ProjectSnapshot): Promise<ProjectSearch> {
    const query = await this.query(subject, snapshot), selected = query.definitions.get(subject) ?? [];
    if (query.associated.some(item => item.locator.format === 'java-alias-1')) {
      const limitation = javaProblem('erased-alias-provenance', 'Java erases transparent aliases; handwritten uses of the underlying type cannot establish the authored alias spelling.', '<associations>');
      query.problems.push(limitation); query.coverage.complete = false; query.coverage.limitations.push(limitation.message);
    }
    const inside = (use: JavaFacts['uses'][number]) => selected.some(node => node.file === use.file && use.start >= node.nodeStart && use.start < node.nodeStart + node.nodeLength);
    const selectedKeys = new Set(selected.map(node => node.key));
    const declarations = new Map(query.facts.declarations.map(node => [node.key, node]));
    const target = (key: string, use?: JavaFacts['uses'][number]) => {
      const id = query.claimed.get(key);
      if (id) return { kind: 'specified' as const, id };
      const node = declarations.get(key), owner = use && query.facts.declarations.find(node => node.type === use.type && !node.member);
      const known = node ?? owner;
      return { kind: 'project' as const, id: canonical(known ? { outputId: this.options.outputId, format: known.file.startsWith('file:') ? 'java-external-symbol-1' : 'java-symbol-1', value: {
        ...(known.file.startsWith('file:') ? { uri: known.file } : { file: known.file }), type: known.type, ...((node ?? use)?.member ? { member: (node ?? use)!.member } : {}),
        ...(node?.parameter === undefined ? {} : { parameter: node.parameter }),
      } } : { outputId: this.options.outputId, format: 'java-file-1', value: { file: use?.file ?? key } }) };
    };
    const owner = (use: JavaFacts['uses'][number] | JavaFacts['unresolved'][number]) => target(use.owners.find(key => query.claimed.has(key)) ?? use.owners[0] ?? use.file);
    const site = (use: JavaFacts['uses'][number] | JavaFacts['unresolved'][number]) => {
      if (use.file.startsWith('file:')) {
        const declaration = use.owners.map(key => declarations.get(key)).find(node => node);
        return { outputId: this.options.outputId, format: 'java-external-symbol-1', value: { uri: use.file,
          ...(declaration ? { type: declaration.type, ...(declaration.member ? { member: declaration.member } : {}) } : {}),
          start: use.start, length: use.length, version: query.snapshot.nativeInputs!.find(input => input.uri === use.file)!.version,
          role: use.role, owner: owner(use) } };
      }
      return { outputId: this.options.outputId, format: 'java-site-1', value: { file: use.file,
        start: use.start, length: use.length, version: query.snapshot.files.find(file => file.path === use.file)!.version, role: use.role, owner: owner(use) } };
    };
    const incoming = query.facts.uses.filter(use => selectedKeys.has(use.key) && !inside(use)).map(use => ({ target: owner(use), at: site(use) }));
    const internal = (use: JavaFacts['uses'][number]) => {
      const declaration = declarations.get(use.key);
      return declaration && inside({ ...use, file: declaration.file, start: declaration.start });
    };
    const outgoing = query.facts.uses.filter(use => inside(use) && !selectedKeys.has(use.key) && !internal(use)).map(use => ({
      target: use.external ? { kind: 'project' as const, id: canonical({ outputId: this.options.outputId, format: 'java-external-symbol-1',
        value: { uri: use.external, type: use.type, ...(use.member ? { member: use.member } : {}) } }) } : target(use.key, use), at: site(use) }));
    const unresolved = query.facts.unresolved.filter(use => !use.file.startsWith('file:')).map(use => ({ at: site(use), reason: use.reason }));
    return structuredClone({ definitions: query.associated.filter(item => item.locator.format === 'java-symbol-1' ? selected.length > 0 : item.locator.format === 'java-alias-1').map(item => item.locator), problems: query.problems,
      incoming: { subject, direction: 'incoming', uses: incoming, unresolved, coverage: query.coverage },
      outgoing: { subject, direction: 'outgoing', uses: outgoing, unresolved, coverage: query.coverage } });
  }
}
