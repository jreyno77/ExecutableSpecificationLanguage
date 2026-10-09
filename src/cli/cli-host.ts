import { isDeepStrictEqual } from 'node:util';
import type { CliHost } from './cli.js';
import { cliProblem } from './cli-check.js';
import type { Diagnostic } from '../compiler/checking.js';
import type { ProblemLocation } from '../compiler/resolution/problem.js';
import type { SourcePosition } from '../language/grammar/source.js';
import type { ProjectContext, ProjectRoot, ProjectSnapshot } from '../project/connection/project-connection.js';
import { builtinNames } from '../model/model.js';

/** Invocation-local admission observations; filesystem and native guards still establish the snapshot. */
export class BuildAdmission {
  readonly problems: Diagnostic[] = [];
  constructor(private readonly manifest: string, readonly signal: AbortSignal, private readonly checkWrite?: CliHost['checkWrite']) {}
  get stopped(): boolean { return this.signal.aborted || this.problems.length > 0; }
  async capture(project: ProjectContext): Promise<ProjectSnapshot> {
    const root = structuredClone(project.root), before = await this.observe(root);
    if (!before.length && this.stopped) before.push(...await this.observe(root));
    if (before.length) return { root, complete: false, files: [], excludeNames: [], excluded: [], problems: before };
    const captured = await (project.captureSnapshot ? project.captureSnapshot() : project.readSnapshot());
    const after = await this.observe(root);
    return after.length ? { ...captured, complete: false, problems: [...captured.problems, ...after] } : captured;
  }
  private async observe(root: ProjectRoot): Promise<Diagnostic[]> {
    if (this.problems.length) return structuredClone(this.problems);
    const failure = (error: unknown): Diagnostic[] => {
      let message = 'The host write check failed.';
      try { message = String(error); } catch {}
      return [cliProblem('host-write-failure', message, this.manifest)];
    };
    const cancelled = () => [cliProblem('write-cancelled', 'The owning host cancelled build admission.', this.manifest)];
    let problems: Diagnostic[];
    if (this.signal.aborted) problems = cancelled();
    else if (this.checkWrite === undefined) return [];
    else if (typeof this.checkWrite !== 'function') problems = failure('checkWrite must be a function.');
    else problems = await new Promise<Diagnostic[]>(resolve => {
      let settled = false;
      const finish = (value: Diagnostic[]) => {
        if (settled) return;
        settled = true; this.signal.removeEventListener('abort', cancel); resolve(value);
      };
      const cancel = () => finish(cancelled());
      this.signal.addEventListener('abort', cancel, { once: true });
      if (this.signal.aborted) { cancel(); return; }
      Promise.resolve().then(() => this.signal.aborted ? [] : this.checkWrite!(structuredClone(root))).then(value => {
        if (settled) return;
        try {
          if (!Array.isArray(value) || ![...value].every(diagnostic)) throw TypeError('checkWrite must return an array of valid Diagnostic values.');
          const copied = value.map(copyDiagnostic);
          if (!copied.every(diagnostic)) throw TypeError('checkWrite diagnostics changed while being copied.');
          finish(copied);
        } catch (error) { finish(failure(error)); }
      }, error => { if (!settled) finish(failure(error)); });
    });
    for (const problem of problems) if (!this.problems.some(previous => isDeepStrictEqual(previous, problem))) this.problems.push(problem);
    return problems;
  }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function path(value: unknown): boolean { return Array.isArray(value) && [...value].every(part => typeof part === 'string' || typeof part === 'number' && Number.isFinite(part)); }
function position(value: unknown): boolean {
  return record(value) && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0
    && Number.isSafeInteger(value.line) && (value.line as number) > 0 && Number.isSafeInteger(value.column) && (value.column as number) > 0;
}
function location(value: unknown): value is ProblemLocation {
  if (!record(value)) return false;
  if (value.kind === 'dependency') return path(value.path);
  if (value.kind === 'external') return typeof value.module === 'string' && path(value.path);
  if (value.kind === 'builtin') return builtinNames.some(name => name === value.name);
  return value.kind === 'source' && typeof value.module === 'string' && record(value.node)
    && typeof value.node.sourceId === 'string' && Number.isSafeInteger(value.node.ordinal) && (value.node.ordinal as number) >= 0
    && record(value.range) && typeof value.range.sourceId === 'string' && position(value.range.start) && position(value.range.end);
}
function diagnostic(value: unknown): value is Diagnostic {
  return record(value) && typeof value.code === 'string' && typeof value.message === 'string'
    && location(value.at) && Array.isArray(value.related) && [...value.related].every(location);
}

function copyDiagnostic(value: Diagnostic): Diagnostic {
  return { code: value.code, message: value.message, at: copyLocation(value.at), related: value.related.map(copyLocation) };
}
function copyLocation(value: ProblemLocation): ProblemLocation {
  switch (value.kind) {
    case 'dependency': return { kind: 'dependency', path: [...value.path] };
    case 'external': return { kind: 'external', module: value.module, path: [...value.path] };
    case 'builtin': return { kind: 'builtin', name: value.name };
    case 'source': return { kind: 'source', module: value.module, node: { sourceId: value.node.sourceId, ordinal: value.node.ordinal },
      range: { sourceId: value.range.sourceId, start: copyPosition(value.range.start), end: copyPosition(value.range.end) } };
  }
}
function copyPosition(value: SourcePosition): SourcePosition { return { offset: value.offset, line: value.line, column: value.column }; }
