import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ProjectRead, ProjectSearch } from './project-inspection.js';
import { KotlinDeclarations, kotlinOptions, type KotlinOptions } from './kotlin-declarations.js';
import { outputProblem } from './output-documents.js';
import { canonical, identifier, locatorSchema, success } from './identity-baseline.js';
import { z } from 'zod';
import { hash, literal } from './project-files.js';
import { KotlinProject } from './kotlin-project.js';

const statePath = '.expec/outputs/' + Buffer.from('kotlin').toString('hex') + '.json';
const state = z.strictObject({ format: z.literal(1), options: z.string(), files: z.array(z.strictObject({
  id: identifier, path: z.string().refine(literal), generated: z.string(), hash: z.string(),
  artifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })),
})) });

export const kotlinOutput: OutputRegistration = {
  id: 'kotlin', validate: options => {
    const result = kotlinOptions.safeParse(options);
    return result.success ? [] : result.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message }));
  },
  open: (options, context) => new KotlinOutput(kotlinOptions.parse(options), context),
};

class KotlinOutput implements OutputAdapter {
  readonly id = 'kotlin';
  constructor(private readonly options: KotlinOptions, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot) {
    const source = snapshot.files.find(file => file.path === statePath);
    if (!source) return undefined;
    const stored = state.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes)));
    if (stored.files.some(file => hash(Buffer.from(file.generated)) !== file.hash)) throw new Error('Invalid generated Kotlin baseline.');
    return stored;
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return { problems: [...snapshot.problems, outputProblem('incomplete-project', '', 'A complete captured project is required.')], deferred: [] };
    if (request.operation !== 'create') return { problems: [outputProblem('native-preservation-unavailable', '', 'Native preservation is not available yet.')], deferred: [] };
    let previous: z.infer<typeof state> | undefined;
    try { previous = this.state(snapshot); } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Recorded Kotlin generation baseline is invalid.')], deferred: [] }; }
    if (previous && previous.options !== canonical(this.options)) return { problems: [outputProblem('output-options-changed', statePath, 'Kotlin placement/options require an explicit migration.')], deferred: [] };
    const declarations = new KotlinDeclarations(request.current, this.options, this.context), files = declarations.render();
    const problems = [...declarations.problems];
    for (const file of files) {
      const existing = snapshot.files.find(existing => existing.path === file.path), before = previous?.files.find(before => before.path === file.path);
      if (existing && (!before || existing.version !== before.hash || existing.version !== hash(Buffer.from(file.text)))) problems.push(outputProblem('output-conflict', file.path, 'Existing native file needs proven contract preservation before changing it.'));
      if (file.path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(outputProblem('excluded-kotlin-input', file.path, 'The captured scope excludes this output destination.'));
    }
    const next = { format: 1, options: canonical(this.options), files: files.map(file => ({ id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: file.artifacts })) };
    const changes = [...files.map(file => ({ kind: 'write' as const, path: file.path, bytes: Buffer.from(file.text) })), { kind: 'write' as const, path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }]
      .filter(change => !snapshot.files.some(file => file.path === change.path && file.version === hash(change.bytes)));
    return problems.length ? { problems, deferred: [] } : success({ outputId: this.id, basedOn: snapshot, changes, artifacts: files.flatMap(file => file.artifacts) });
  }
  async read(id: string, snapshot: ProjectSnapshot): Promise<ProjectRead> {
    return new KotlinProject({ outputId: this.id }, this.state(snapshot)?.files.flatMap(file => file.artifacts) ?? []).read(id, snapshot);
  }
  async search(id: string, snapshot: ProjectSnapshot): Promise<ProjectSearch> {
    return new KotlinProject({ outputId: this.id }, this.state(snapshot)?.files.flatMap(file => file.artifacts) ?? []).search(id, snapshot);
  }
}
