import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { PackagePhase } from '../../compiler/resolution/package-availability.js';
import type { ProblemLocation } from '../../compiler/resolution/problem.js';
import type { Configuration } from '../connection/configuration.js';
import { scopePath, validateConfiguration } from '../connection/configuration-schema.js';

export interface RequirementSource {
  readonly sourceId: string;
  readonly localPath?: string;
}
export interface ScopedPackageRequirement {
  readonly sourceId: string;
  readonly alias: string;
  readonly phase: PackagePhase;
  readonly at: ProblemLocation;
  readonly related: readonly ProblemLocation[];
}

/** Prepare additive requirements for supplied source identities, without acquiring files or packages. */
export function requirementsFor(configuration: Configuration,
  sources: readonly RequirementSource[]): Check<readonly ScopedPackageRequirement[]> {
  const { sourceId, ...metadata } = configuration;
  const configured = validateConfiguration(metadata, sourceId);
  if (!configured.value) return { problems: configured.problems, deferred: configured.deferred };
  const problems: Diagnostic[] = [], captured = new Map<string, RequirementSource>();
  const at = (index: number, field: string): ProblemLocation => ({ kind: 'dependency', path: ['sources', index, field] });
  const seen = new Map<string, number>();
  if (!Array.isArray(sources)) return { problems: [{ code: 'invalid-dependency-input', message: 'Provide source mappings.',
    at: { kind: 'dependency', path: ['sources'] }, related: [] }], deferred: [] };
  for (const [index, source] of sources.entries()) {
    const problem = (field: string, message: string, related: readonly ProblemLocation[] = []) =>
      problems.push({ code: 'invalid-dependency-input', message, at: at(index, field), related });
    if (!source || typeof source.sourceId !== 'string' || !source.sourceId.trim()) {
      problem('sourceId', 'Provide a nonblank captured source identity.'); continue;
    }
    if (source.localPath !== undefined && !scopePath(source.localPath)) {
      problem('localPath', 'Provide a literal manifest-relative source path using / separators.'); continue;
    }
    const previous = seen.get(source.sourceId);
    if (previous !== undefined && captured.get(source.sourceId)!.localPath !== source.localPath) {
      problem('sourceId', 'One source identity cannot have conflicting scope paths.', [at(previous, 'sourceId')]);
    } else if (previous === undefined) {
      seen.set(source.sourceId, index);
      captured.set(source.sourceId, { sourceId: source.sourceId, ...(source.localPath !== undefined ? { localPath: source.localPath } : {}) });
    }
  }
  if (problems.length) return { problems, deferred: [] };
  const requirements = configured.value.requirements, result: ScopedPackageRequirement[] = [];
  if (!requirements) return { value: result, problems, deferred: [] };
  const origin = (...path: (string | number)[]): ProblemLocation => ({ kind: 'dependency', path: ['manifest', sourceId, 'requirements', ...path] });
  for (const source of captured.values()) {
    const folders = (requirements.folders ?? []).map((value, index) => ({ value, index }))
      .filter(({ value }) => source.localPath?.startsWith(value.path + '/'))
      .sort((a, b) => a.value.path.split('/').length - b.value.path.split('/').length);
    const scopes = [
      { value: requirements.project, path: ['project'] },
      ...folders.map(({ value, index }) => ({ value, path: ['folders', index] })),
      ...(requirements.files ?? []).flatMap((value, index) => value.path === source.localPath ? [{ value, path: ['files', index] }] : []),
    ];
    const effective = new Map<string, ScopedPackageRequirement & { related: ProblemLocation[] }>();
    for (const scope of scopes) for (const phase of ['build', 'runtime', 'test'] as const) {
      for (const [index, alias] of (scope.value?.[phase] ?? []).entries()) {
        const location = origin(...scope.path, phase, index), key = JSON.stringify([alias, phase]);
        const existing = effective.get(key);
        if (existing) existing.related.push(location);
        else effective.set(key, { sourceId: source.sourceId, alias, phase, at: location, related: [] });
      }
    }
    result.push(...effective.values());
  }
  return { value: result, problems, deferred: [] };
}
