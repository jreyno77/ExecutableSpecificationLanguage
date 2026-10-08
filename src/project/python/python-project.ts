import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ArtifactAssociation, ArtifactLocator, RelationshipObservation } from '../../model/specification-identity.js';
import type { ProjectRead, ProjectSearch } from '../connection/project-inspection.js';
import { z } from 'zod';
import { canonical, identifier } from '../../model/identity-baseline.js';
import { pythonPath } from './python-profile.js';
import { PythonInspection, pythonSelector, pythonTargetKey, type PythonFacts } from './python-inspection.js';
import { outputProblem } from '../output/output-documents.js';

const symbol = z.strictObject({ file: z.string().refine(pythonPath), declaration: pythonSelector });
const file = z.strictObject({ file: z.string().refine(pythonPath) });
const settings = z.strictObject({ outputId: z.string().min(1).refine(value => value === value.trim()), configFile: z.string().refine(pythonPath).optional() });
type Declaration = PythonFacts['declarations'][number];
const prefix = (left: Declaration['declaration'], right: Declaration['declaration']): boolean => left.length <= right.length && left.every((part, index) => canonical(part) === canonical(right[index]));

/** Native Python definitions and uses from the supplied project capture. */
export class PythonProject {
  private readonly options: { outputId: string; configFile?: string };
  private readonly associations: readonly ArtifactAssociation[];
  private readonly inspection = new PythonInspection();
  constructor(options: { outputId: string; configFile?: string }, associations: readonly ArtifactAssociation[]) {
    const parsed = settings.safeParse(options);
    if (!parsed.success || !Array.isArray(associations) || associations.some(item => !identifier.safeParse(item?.specId).success || !item.locator
      || item.locator.outputId !== options.outputId || !(item.locator.format === 'python-symbol-1' ? symbol : item.locator.format === 'python-file-1' ? file : z.never()).safeParse(item.locator.value).success)
      || new Set(associations.map(item => canonical(item.locator))).size !== associations.length) throw new TypeError('Provide Python settings and distinct native artifact associations.');
    this.options = structuredClone(options); this.associations = structuredClone(associations);
  }
  private at(format: string, value: ArtifactLocator['value']): ArtifactLocator { return { outputId: this.options.outputId, format, value }; }
  private scope(facts?: PythonFacts): ArtifactLocator[] { return [this.at('python-scope-1', { files: facts?.files ?? [] })]; }
  private select(association: ArtifactAssociation, facts: PythonFacts): Declaration[] {
    if (association.locator.format !== 'python-symbol-1') return [];
    const at = symbol.parse(association.locator.value);
    return facts.declarations.filter(item => item.file === at.file && canonical(item.declaration) === canonical(at.declaration));
  }
  async read(id: string, snapshot: ProjectSnapshot): Promise<ProjectRead> {
    if (!identifier.safeParse(id).success) throw new TypeError('Provide a specification identifier.');
    snapshot = structuredClone(snapshot);
    const inspected = await this.inspection.inspect(snapshot, this.options.configFile), selected = this.associations.filter(item => item.specId === id), problems = [...inspected.problems];
    if (!selected.length) problems.push(outputProblem('project-artifact-not-found', '', 'No Python association identifies ' + id + '.'));
    const artifacts: ProjectRead['artifacts'][number][] = [];
    if (inspected.value) for (const association of selected) {
      const path = file.passthrough().parse(association.locator.value).file, captured = snapshot.files.find(file => file.path === path);
      if (!captured || association.locator.format === 'python-symbol-1' && this.select(association, inspected.value).length !== 1) {
        problems.push(outputProblem('python-definition-unavailable', path, 'The associated native declaration must have exactly one definition.')); continue;
      }
      if (!artifacts.some(item => item.file.path === path)) artifacts.push({ at: association.locator, file: captured });
    }
    return structuredClone({ artifacts, problems, coverage: { scope: this.scope(inspected.value), complete: !!inspected.value && !problems.length,
      limitations: problems.map(problem => problem.message) } });
  }
  async search(id: string, snapshot: ProjectSnapshot): Promise<ProjectSearch> {
    if (!identifier.safeParse(id).success) throw new TypeError('Provide a specification identifier.');
    snapshot = structuredClone(snapshot);
    const inspected = await this.inspection.inspect(snapshot, this.options.configFile), problems = [...inspected.problems], facts = inspected.value;
    const selected = this.associations.filter(item => item.specId === id), declarations = facts ? selected.flatMap(item => this.select(item, facts)) : [];
    if (!selected.length || facts && !declarations.length) problems.push(outputProblem('python-definition-unavailable', '', 'No exact native definition identifies ' + id + '.'));
    const incoming: RelationshipObservation['uses'][number][] = [], outgoing: RelationshipObservation['uses'][number][] = [], unresolved: RelationshipObservation['unresolved'][number][] = [];
    if (facts) {
      const names = new Set(declarations.map(item => item.target.name)), keys = new Set(declarations.map(item => pythonTargetKey(item.target)));
      const specified = new Map(this.associations.flatMap(association => this.select(association, facts).map(item => [pythonTargetKey(item.target), association.specId] as const)));
      for (const use of facts.uses) {
        const at = this.at('python-use-1', { file: use.file, start: use.start, end: use.end }), targets = use.targets;
        if (targets.length === 1 && keys.has(pythonTargetKey(targets[0]!))) {
          const owner = facts.declarations.find(item => item.file === use.file && canonical(item.declaration) === canonical(use.owner));
          const known = owner && specified.get(pythonTargetKey(owner.target));
          incoming.push({ target: known ? { kind: 'specified', id: known } : { kind: 'project', id: canonical({ file: use.file, declaration: use.owner }) }, at });
        }
        else if (use.member && names.has(use.name) && targets.length !== 1) unresolved.push({ at, reason: 'The native member has ' + targets.length + ' possible declarations.' });
        if (declarations.some(item => item.file === use.file && use.start >= item.begin && use.end <= item.finish)) for (const target of targets) {
          if (target.builtin || facts.declarations.some(item => pythonTargetKey(item.target) === pythonTargetKey(target) && declarations.some(owner => owner.file === item.file && prefix(owner.declaration, item.declaration)))) continue;
          const known = specified.get(pythonTargetKey(target));
          outgoing.push({ at, target: known ? { kind: 'specified', id: known } : { kind: 'project', id: 'python:' + pythonTargetKey(target) } });
        }
      }
    }
    const coverage = { scope: this.scope(facts), complete: !!facts && !problems.length && !unresolved.length,
      limitations: [...problems.map(problem => problem.message), ...unresolved.map(item => item.reason)] };
    return structuredClone({ definitions: declarations.map(item => this.at('python-symbol-1', { file: item.file, declaration: item.declaration })), problems,
      incoming: { subject: id, direction: 'incoming', uses: incoming, unresolved, coverage }, outgoing: { subject: id, direction: 'outgoing', uses: outgoing, unresolved, coverage } });
  }
}
