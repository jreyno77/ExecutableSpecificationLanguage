import { z } from 'zod';
import type { ArtifactAssociation, ArtifactLocator, RelationshipObservation } from './specification-identity.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ProjectRead, ProjectSearch } from './project-inspection.js';
import { canonical, identifier, locatorSchema } from './identity-baseline.js';
import { literal, problem } from './project-files.js';
import { kotlinConfigurationOptions } from './kotlin-configuration.js';
import { kotlinSelector, queryKotlin, type KotlinQuery } from './kotlin-query.js';

const symbol = z.strictObject({ file: z.string().refine(literal), declaration: kotlinSelector.refine(path => path.every(item => !item.name.startsWith('<anonymous@'))) });
const file = z.strictObject({ file: z.string().refine(literal) });
type Declaration = KotlinQuery['declarations'][number];

/** Reads current native bytes and asks K2 for actual definitions and bound references. */
export class KotlinProject {
  private readonly configFile: string;
  private readonly outputId: string;
  private readonly artifacts: readonly ArtifactAssociation[];
  constructor(options: { readonly outputId: string; readonly configFile?: string }, artifacts: readonly ArtifactAssociation[]) {
    if (!options || typeof options.outputId !== 'string' || !options.outputId.trim() || Object.keys(options).some(key => !['outputId', 'configFile'].includes(key))) throw new TypeError('Provide a native output identity and optional configuration.');
    this.outputId = options.outputId; this.configFile = kotlinConfigurationOptions(options.configFile === undefined ? {} : { configFile: options.configFile });
    if (!Array.isArray(artifacts) || artifacts.some(item => !identifier.safeParse(item.specId).success || !locatorSchema.safeParse(item.locator).success
      || item.locator.outputId !== this.outputId || !(item.locator.format === 'kotlin-symbol-1' ? symbol : item.locator.format === 'kotlin-file-1' ? file : z.never()).safeParse(item.locator.value).success)) throw new TypeError('Provide actual Kotlin symbol or companion associations.');
    this.artifacts = structuredClone(artifacts);
  }
  private at(value: unknown): ArtifactLocator { return { outputId: this.outputId, format: 'kotlin-site-1', value: value as ArtifactLocator['value'] }; }
  private matches(declaration: Declaration, id: string): boolean {
    return this.artifacts.some(item => item.specId === id && item.locator.format === 'kotlin-symbol-1'
      && canonical(item.locator.value) === canonical({ file: declaration.file, declaration: declaration.selector }));
  }
  private identity(declaration: Declaration) {
    const mapped = this.artifacts.find(item => item.locator.format === 'kotlin-symbol-1'
      && canonical(item.locator.value) === canonical({ file: declaration.file, declaration: declaration.selector }));
    return mapped ? { kind: 'specified' as const, id: mapped.specId } : { kind: 'project' as const, id: canonical({ file: declaration.file, declaration: declaration.selector }) };
  }
  async read(id: string, snapshot: ProjectSnapshot): Promise<ProjectRead> {
    const searched = await this.search(id, snapshot);
    const selected = this.artifacts.filter(item => item.specId === id);
    return { artifacts: selected.flatMap(item => { const path = (item.locator.value as { file: string }).file, file = snapshot.files.find(file => file.path === path); return file ? [{ at: item.locator, file }] : []; }),
      coverage: searched.outgoing.coverage, problems: searched.problems };
  }
  async search(id: string, snapshot: ProjectSnapshot): Promise<ProjectSearch> {
    if (!identifier.safeParse(id).success) throw new TypeError('Provide an established specification identifier.');
    const captured = structuredClone(snapshot), checked = await queryKotlin(captured, this.configFile), problems = [...checked.problems];
    const declarations = checked.value?.declarations ?? [], selected = declarations.filter(node => this.matches(node, id));
    if (!selected.length) problems.push(problem(snapshot.root, 'native-definition-unavailable', '', 'No unique current Kotlin declaration is associated with ' + id + '.'));
    const scope = (checked.value?.files ?? []).map(file => ({ outputId: this.outputId, format: 'kotlin-file-1', value: { file } }));
    const coverage = { scope, complete: !problems.length && scope.length > 0, limitations: problems.map(problem => problem.message) };
    if (!scope.length && !coverage.limitations.length) coverage.limitations.push('No captured Kotlin source files.');
    const incoming: RelationshipObservation['uses'][number][] = [], outgoing: RelationshipObservation['uses'][number][] = [];
    for (const reference of checked.value?.references ?? []) {
      const target = declarations.find(node => node.file === reference.targetFile && canonical(node.selector) === canonical(reference.target));
      const owner = declarations.find(node => node.file === reference.file && canonical(node.selector) === canonical(reference.owner));
      const at = this.at({ file: reference.file, ...reference.range, role: reference.role });
      if (target && (selected.includes(target) || target.kind === 'constructor' && selected.some(node => node.file === target.file
        && canonical(node.selector) === canonical(target.selector.slice(0, -1))))) incoming.push({ target: owner ? this.identity(owner) : { kind: 'project', id: reference.file }, at });
      if (selected.some(node => node.file === reference.file && node.range.start <= reference.range.start && node.range.end >= reference.range.end)) {
        if (target) outgoing.push({ target: this.identity(target), at });
        else if (reference.external) outgoing.push({ target: { kind: 'project', id: 'kotlin:' + reference.external }, at });
      }
    }
    return { definitions: selected.map(node => this.at({ file: node.file, ...node.nameRange, role: 'definition' })), problems,
      incoming: { subject: id, direction: 'incoming', coverage, uses: incoming, unresolved: [] },
      outgoing: { subject: id, direction: 'outgoing', coverage, uses: outgoing, unresolved: [] } };
  }
}
