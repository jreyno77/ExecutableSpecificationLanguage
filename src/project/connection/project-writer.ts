import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectContext, ProjectRoot, ProjectSnapshot } from './project-connection.js';
import { ProjectFiles, fail, hash, literal, marker, message, problem, sameIdentity, sameObservation, type ObservedFile } from './project-files.js';
import { packagePath, sameReadOnly, validateReadOnly } from './project-readonly.js';
import { nativeInputs, protectsNativeInput, sameNativeInputs } from './native-inputs.js';

export interface ProjectWriter { apply(input: ProjectChanges, signal?: AbortSignal): Promise<WriteResult> }
export interface ProjectChanges { readonly basedOn: ProjectSnapshot; readonly changes: readonly FileChange[] }
export type FileChange =
  | { readonly kind: 'write'; readonly path: string; readonly bytes: Uint8Array }
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'move'; readonly from: string; readonly to: string; readonly bytes?: Uint8Array };
export type FileObservation =
  | { readonly path: string; readonly state: 'file'; readonly bytes: Uint8Array; readonly version: string }
  | { readonly path: string; readonly state: 'absent' | 'unknown' };
export interface WriteResult {
  readonly root: ProjectRoot;
  readonly status: 'applied' | 'unchanged' | 'stopped';
  readonly outcomes: readonly { readonly change: FileChange; readonly state: 'applied' | 'unchanged' | 'not-applied' | 'uncertain';
    readonly before: readonly FileObservation[]; readonly after: readonly FileObservation[] }[];
  readonly problems: readonly Diagnostic[];
  readonly createdDirectories: readonly string[];
  readonly temporaryPaths: readonly string[];
}
export class FileProjectWriter implements ProjectWriter {
  constructor(private readonly context: ProjectContext) {}
  async apply(input: ProjectChanges, signal?: AbortSignal): Promise<WriteResult> {
    const captured: ProjectChanges = structuredClone(input), root = { ...this.context.root };
    const { basedOn, changes } = captured, files = new ProjectFiles(root), problems: Diagnostic[] = [];
    const outcomes: Outcome[] = changes.map(change => ({ change, state: 'not-applied',
      before: paths(change).map(path => ({ path, state: 'unknown' })), after: paths(change).map(path => ({ path, state: 'unknown' })) }));
    const checked = new Map<string, ObservedFile>(), expected = new Map(basedOn.files.map(file => [file.path, file.version]));
    let safe = false, currentPath = '', next = 0;
    const cancel = () => { if (signal?.aborted) fail(root, 'write-cancelled', currentPath, 'File application was cancelled.'); };
    const guard = async () => {
      await files.verifyRoot(); await files.verifyLock();
      const fresh = await this.context.readSnapshot();
      await files.verifyLock();
      if (!fresh.complete || fresh.problems.length) fail(root, 'incomplete-project', '', 'A complete current project snapshot is required.');
      if (!sameRoot(root, fresh.root) || !sameList(basedOn.excludeNames, fresh.excludeNames) || !sameReadOnly(basedOn, fresh) || !sameNativeInputs(basedOn, fresh)) {
        fail(root, 'stale-project', '', 'Project root, exclusions, or native inputs changed.');
      }
      const actual = fresh.files.filter(file => file.path !== marker);
      if (!sameList([...basedOn.excluded].sort(), [...fresh.excluded].sort())
        || actual.length !== expected.size || new Set(actual.map(file => file.path)).size !== actual.length
        || actual.some(file => expected.get(file.path) !== file.version || hash(file.bytes) !== file.version)) {
        fail(root, 'stale-project', '', 'Project files or excluded entries changed after planning.');
      }
    };
    try {
      validate(root, basedOn, changes);
      await files.verifyRoot(); safe = true; cancel();
      for (const outcome of outcomes) {
        for (const path of paths(outcome.change)) {
          currentPath = path;
          const observed = await files.read(path);
          checked.set(path, observed);
          outcome.before[paths(outcome.change).indexOf(path)] = observed.value;
          if (observed.info && observed.info.nlink > 1n) fail(root, 'unsupported-change', path, 'Destructive changes to multiply linked files are unsupported.');
        }
        outcome.before = paths(outcome.change).map(path => checked.get(path)!.value);
        const change = outcome.change;
        if (change.kind === 'move') {
          const source = checked.get(change.from)!, destination = checked.get(change.to)!;
          if (source.info && destination.info && sameIdentity(source.info, destination.info)) {
            fail(root, 'unsupported-change', change.to, 'A move between filesystem aliases is unsupported.');
          }
          if (source.value.state !== 'file' || destination.value.state !== 'absent') {
            fail(root, 'invalid-change', change.to, 'A move requires an existing source file and an absent destination.');
          }
        }
      }
      await files.acquire();
      for (; next < outcomes.length; next++) {
        const outcome = outcomes[next]!, change = outcome.change;
        currentPath = paths(change)[0]!;
        cancel(); await guard(); cancel();
        for (const path of paths(change)) {
          currentPath = path; checked.set(path, await files.verify(path, checked.get(path)!));
        }
        outcome.before = paths(change).map(path => checked.get(path)!.value);
        const source = checked.get(paths(change)[0]!)!, desired = desiredFiles(change, source.value);
        if (desired.every(value => sameObservation(value, checked.get(value.path)!.value))) {
          outcome.state = 'unchanged'; outcome.after = structuredClone(outcome.before); continue;
        }
        let failed = false, error: unknown;
        try {
          if (change.kind === 'write') await files.write(change.path, change.bytes, source);
          else if (change.kind === 'remove') await files.remove(change.path, source);
          else {
            const target = desired[1]!;
            if (target.state !== 'file') throw new TypeError('Move destination must describe a file.');
            currentPath = change.to;
            await files.write(change.to, target.bytes, checked.get(change.to)!, Number(source.info!.mode & 0o777n));
            const destination = await files.read(change.to);
            if (!sameObservation(destination.value, desired[1]!)) fail(root, 'verification-failed', change.to, 'Move destination was not verified; source was retained.');
            expected.set(change.to, target.version);
            cancel(); await guard(); cancel();
            currentPath = change.from;
            await files.remove(change.from, source);
          }
        } catch (cause) { failed = true; error = cause; }
        outcome.after = await Promise.all(paths(change).map(path => files.observe(path)));
        if (failed) {
          outcome.state = outcome.before.every((value, index) => sameObservation(value, outcome.after[index]!)) ? 'not-applied' : 'uncertain';
          throw error;
        }
        if (!desired.every((value, index) => sameObservation(value, outcome.after[index]!))) {
          outcome.state = 'uncertain';
          fail(root, 'verification-failed', currentPath, 'The requested final file state could not be verified.');
        }
        outcome.state = 'applied';
        for (const observation of outcome.after) {
          if (observation.state === 'file') expected.set(observation.path, observation.version);
          else expected.delete(observation.path);
        }
      }
      cancel(); await guard(); cancel();
    } catch (error) {
      problems.push(error && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic as Diagnostic
        : problem(root, 'write-failed', currentPath, message(error)));
    }
    if (safe) {
      for (const outcome of outcomes.filter(item => item.state === 'not-applied')) {
        outcome.after = await Promise.all(paths(outcome.change).map(path => literal(path) ? files.observe(path) : { path, state: 'unknown' } as const));
      }
    }
    const cleanup = await files.cleanup(problems);
    return { root, status: problems.length ? 'stopped' : outcomes.some(item => item.state === 'applied') ? 'applied' : 'unchanged',
      outcomes: structuredClone(outcomes), problems, ...cleanup };
  }
}

type Outcome = { change: FileChange; state: WriteResult['outcomes'][number]['state']; before: FileObservation[]; after: FileObservation[] };
function paths(change: FileChange): string[] { return change.kind === 'move' ? [change.from, change.to] : [change.path]; }
function sameRoot(a: ProjectRoot, b: ProjectRoot): boolean { return a.path === b.path && a.identity === b.identity; }
function sameList(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function desiredFiles(change: FileChange, previous: FileObservation): FileObservation[] {
  const file = (path: string, bytes: Uint8Array): FileObservation => ({ path, state: 'file', bytes, version: hash(bytes) });
  if (change.kind === 'write') return [file(change.path, change.bytes)];
  if (change.kind === 'remove') return [{ path: change.path, state: 'absent' }];
  if (previous.state !== 'file') throw new TypeError('Move source has not been observed.');
  return [{ path: change.from, state: 'absent' }, file(change.to, change.bytes ?? previous.bytes)];
}
function validate(root: ProjectRoot, baseline: ProjectSnapshot, changes: readonly FileChange[]): void {
  const invalid = (path: string, text: string) => fail(root, 'invalid-change', path, text);
  if (!baseline.complete || baseline.problems.length) fail(root, 'incomplete-project', '', 'A complete baseline is required.');
  if (!sameRoot(root, baseline.root)) fail(root, 'stale-project', '', 'The baseline belongs to another project root.');
  if (!validateReadOnly(baseline)) invalid('', 'Read-only native evidence must be valid, separate, and hash-verified.');
  if (!nativeInputs(baseline)) invalid('', 'Native inputs require unique canonical local file URLs and SHA256 byte versions.');
  if (baseline.excludeNames.includes('.expec')) invalid('.expec', 'The writer coordination directory cannot be excluded.');
  if (new Set(baseline.files.map(file => file.path)).size !== baseline.files.length
    || baseline.files.some(file => !literal(file.path) || !/^[a-f0-9]{64}$/.test(file.version) || hash(file.bytes) !== file.version)
    || baseline.excluded.some(path => !literal(path))) invalid('', 'Baseline paths and byte versions must be valid and unique.');
  const used: string[] = [];
  for (const change of changes) {
    if (!['write', 'remove', 'move'].includes(change.kind)) invalid('', 'Unknown file operation.');
    for (const path of paths(change)) {
      const reserved = process.platform === 'win32' ? path.toLowerCase() : path;
      if (!literal(path) || packagePath(path) || protectsNativeInput(baseline, path) || baseline.excluded.some(entry => packagePath(entry) && entry.startsWith(path + '/')) || path.split('/').some(part => baseline.excludeNames.includes(part))
        || reserved === marker || reserved.startsWith(marker + '/') || reserved === '.expec') {
        invalid(path, 'Provide a literal, included file path outside writer coordination and protected native inputs.');
      }
      if (used.some(other => path === other || path.startsWith(other + '/') || other.startsWith(path + '/'))) {
        invalid(path, 'File operations cannot overlap or use another endpoint as a parent.');
      }
      if (process.platform === 'win32' && used.some(other => path.toLowerCase() === other.toLowerCase()
        || path.toLowerCase().startsWith(other.toLowerCase() + '/') || other.toLowerCase().startsWith(path.toLowerCase() + '/'))) {
        fail(root, 'unsupported-change', path, 'Case aliases cannot be used as independent file endpoints.');
      }
      used.push(path);
    }
    if ((change.kind === 'write' || 'bytes' in change) && !(change.bytes instanceof Uint8Array)) {
      invalid(paths(change)[0]!, 'File contents must be bytes.');
    }
  }
}
