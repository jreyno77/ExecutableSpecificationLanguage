import ts from 'typescript';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation, SpecDiff } from './specification-identity.js';
import type { FileChange } from './project-writer.js';
import type { AcceptanceOptions } from './acceptance-bindings.js';
import type { AcceptanceFile } from './acceptance-projection.js';
import { TypeScriptPreservation, type NativeBaseline } from './typescript-preservation.js';
import { typescriptOptions, type NativeFile } from './typescript-declarations.js';
import { acceptancePlacement, driverContracts, type AcceptanceState } from './acceptance-state.js';
import { hash } from './project-files.js';
import { diagnostic } from './typescript-capture.js';
import { NativeEdits, tokens } from './typescript-edits.js';
import { nativeSelection, type Selector } from './typescript-symbols.js';

/** Coordinates native member preservation and output-owned resource files. No project effects. */
export class AcceptancePreservation {
  readonly problems: Diagnostic[] = [];
  readonly changes: FileChange[] = [];
  readonly state: AcceptanceState;
  private readonly captured: ProjectSnapshot;
  constructor(snapshot: ProjectSnapshot, private readonly options: AcceptanceOptions, previous: AcceptanceState | undefined, rendered: readonly AcceptanceFile[],
    associations: readonly ArtifactAssociation[], mappings: readonly ArtifactAssociation[], driver: { file: string; name: string } | undefined, diff?: SpecDiff) {
    this.state = { format: 1, options: acceptancePlacement(options), mappings: previous?.mappings ?? [], deleted: previous?.deleted ?? [], authored: previous?.authored ?? [], files: [] };
    let captured = snapshot;
    const className = options.domain[0]!.toUpperCase() + options.domain.slice(1), nativeOptions = typescriptOptions.parse({ directory: options.testRoot, configFile: options.configFile });
    for (const file of rendered) {
      const role = file.path === (driver?.file ?? options.testRoot + '/driver/' + options.domain + '.ts') ? 'driver'
        : file.path === options.testRoot + '/dsl/' + options.domain + '.ts' ? 'dsl' : undefined;
      const before = previous?.files.find(item => item.path === file.path), original = snapshot.files.find(item => item.path === file.path),
        artifacts = associations.filter(item => (item.locator.value as { file: string }).file === file.path);
      if (role) {
        const mapped = mappings.filter(item => item.locator.outputId === 'acceptance' && item.locator.format === 'typescript-symbol-1'
          && (item.locator.value as { file: string }).file === file.path);
        if (original && !before && !(options.adoptExisting && (role === 'driver' && driver || role === 'dsl' && options.fixture))) { this.problems.push(diagnostic('unowned-project-artifact', 'Existing code needs explicit native adoption.', file.path)); continue; }
        if (!before && driver && role === 'driver' && artifacts.some(item => !mapped.some(mapping => mapping.specId === item.specId))) {
          this.problems.push(diagnostic('adoption-contract-mismatch', 'Every current driver operation needs an explicit existing member.', file.path)); continue;
        }
        const text = role === 'driver' && (before || driver && original) ? driverContracts(file.text, file.path, artifacts,
          before?.generated ?? new TextDecoder().decode(original!.bytes), !before, before?.renderedArtifacts ?? before?.artifacts ?? mapped) : file.text;
        const wanted: NativeFile = { id: role, path: file.path, text, artifacts,
          container: { role, declaration: [{ kind: 'class', name: role === 'driver' ? driver?.name ?? className + 'Driver' : className }] } };
        const preservation = new TypeScriptPreservation(captured, nativeOptions, diff, 'acceptance');
        preservation.reconcile(before ? [before] : [], [wanted], mapped, !previous && options.adoptExisting);
        this.problems.push(...preservation.problems); this.state.files.push(...preservation.files);
        for (const change of preservation.changes) {
          if (change.kind === 'move') { const bytes = change.bytes ?? captured.files.find(file => file.path === change.from)!.bytes;
            captured = { ...captured, files: captured.files.filter(file => file.path !== change.from && file.path !== change.to).concat([{ path: change.to, bytes, version: hash(bytes) }]) }; }
          else captured = { ...captured, files: captured.files.filter(file => file.path !== change.path).concat(change.kind === 'write' ? [{ path: change.path, bytes: change.bytes, version: hash(change.bytes) }] : []) };
        }
        if (role === 'dsl' && before) {
          const current = captured.files.find(item => item.path === file.path)!;
          const bodies = authoredBodies(file, before, preservation.files[0], new TextDecoder().decode(current.bytes));
          this.problems.push(...bodies.problems);
          if (bodies.text !== new TextDecoder().decode(current.bytes)) {
            const bytes = Buffer.from(bodies.text); captured = { ...captured, files: captured.files.map(item => item.path === file.path ? { path: file.path, bytes, version: hash(bytes) } : item) };
            preservation.files[0]!.confirmed = hash(bytes);
          }
        }
      } else {
        if (original && !before) { this.problems.push(diagnostic('unowned-project-artifact', 'Existing code is not owned by this output.', file.path)); continue; }
        if (before && !original) { this.problems.push(diagnostic('output-conflict', 'Recorded output is missing.', file.path)); continue; }
        const changed = before?.hash !== hash(Buffer.from(file.text));
        if (changed && before && original!.version !== before.confirmed) { this.problems.push(diagnostic('output-conflict', 'Handwritten edits compete with the requested generated change.', file.path)); continue; }
        const bytes = changed ? Buffer.from(file.text) : captured.files.find(item => item.path === file.path)!.bytes;
        this.state.files.push({ id: file.path, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: [...artifacts], confirmed: hash(bytes) });
        captured = { ...captured, files: captured.files.filter(item => item.path !== file.path).concat([{ path: file.path, bytes, version: hash(bytes) }]) };
      }
    }
    for (const file of previous?.files ?? []) if (!this.state.files.some(item => item.path === file.path)) {
      if (options.fixture && file.path === options.testRoot + '/dsl/' + options.domain + '-test.ts') { this.state.files.push(file); continue; }
      const original = snapshot.files.find(item => item.path === file.path);
      if (!original || original.version !== file.confirmed) this.problems.push(diagnostic('output-conflict', 'A removed generated file contains competing edits or is missing.', file.path));
      else captured = { ...captured, files: captured.files.filter(item => item.path !== file.path) };
    }
    // Preserve dependency order; the real writer rechecks acquisition after every effect.
    for (const path of [...rendered.map(file => file.path), ...captured.files.map(file => file.path)]) {
      if (this.changes.some(change => change.kind !== 'move' && change.path === path)) continue;
      const file = captured.files.find(file => file.path === path), before = snapshot.files.find(file => file.path === path);
      if (file && before?.version !== file.version) this.changes.push({ kind: 'write', path, bytes: file.bytes });
    }
    for (const file of snapshot.files) if (!captured.files.some(item => item.path === file.path)) this.changes.push({ kind: 'remove', path: file.path });
    this.captured = captured;
  }
  unfinished(implementations: ReadonlyMap<string, Diagnostic>): Diagnostic[] {
    return [...implementations].flatMap(([id, problem]) => {
      const file = this.state.files.find(file => file.container?.role === 'driver' && file.artifacts.some(item => item.specId === id))
        ?? this.state.files.find(file => file.container?.role === 'dsl' && file.artifacts.some(item => item.specId === id));
      if (!file || file.adopted?.includes(id)) return [];
      const actual = this.captured.files.find(item => item.path === file.path), artifact = file.artifacts.find(item => item.specId === id)!;
      const selectors = (artifact.locator.value as unknown as { declaration: readonly Selector[] }).declaration;
      const baseline = nativeSelection(ts.createSourceFile(file.path, file.generated, ts.ScriptTarget.Latest, true), selectors)[0],
        current = actual && nativeSelection(ts.createSourceFile(file.path, new TextDecoder().decode(actual.bytes), ts.ScriptTarget.Latest, true), selectors)[0];
      return baseline && current && ts.isMethodDeclaration(baseline) && ts.isMethodDeclaration(current)
        && baseline.body && current.body && tokens(baseline.body.getText()) !== tokens(current.body.getText()) ? [] : [file.container?.role === 'driver' && this.options.fixture && !this.options.driver
          ? { ...problem, code: 'unselected-default-scaffold', message: 'Unselected default scaffold: ' + problem.message + ' Its use depends on the authored fixture.' } : problem];
    });
  }
}

function authoredBodies(desired: AcceptanceFile, before: NativeBaseline, after: NativeBaseline | undefined, text: string): { text: string; problems: Diagnostic[] } {
  const prior = ts.createSourceFile(desired.path, before.generated, ts.ScriptTarget.Latest, true),
    wanted = ts.createSourceFile(desired.path, desired.text, ts.ScriptTarget.Latest, true), current = ts.createSourceFile(desired.path, text, ts.ScriptTarget.Latest, true),
    edits = new NativeEdits(), problems: Diagnostic[] = [];
  for (const artifact of before.renderedArtifacts ?? before.artifacts) {
    const selectors = (artifact.locator.value as unknown as { declaration: readonly Selector[] }).declaration;
    if (!selectors) continue;
    const desiredArtifact = (after?.renderedArtifacts ?? after?.artifacts)?.find(item => item.specId === artifact.specId),
      actualArtifact = after?.artifacts.find(item => item.specId === artifact.specId);
    if (!desiredArtifact || !actualArtifact) continue;
    const previous = nativeSelection(prior, selectors)[0],
      next = nativeSelection(wanted, (desiredArtifact.locator.value as unknown as { declaration: readonly Selector[] }).declaration)[0],
      actual = nativeSelection(current, (actualArtifact.locator.value as unknown as { declaration: readonly Selector[] }).declaration)[0];
    if (before.adopted?.includes(artifact.specId) || !previous || !next || !actual || !ts.isMethodDeclaration(previous) || !ts.isMethodDeclaration(next) || !ts.isMethodDeclaration(actual)
      || !previous.body || !next.body || !actual.body || tokens(previous.body.getText()) === tokens(next.body.getText()) || tokens(actual.body.getText()) === tokens(next.body.getText())) continue;
    if (tokens(actual.body.getText()) !== tokens(previous.body.getText())) problems.push(diagnostic('handwritten-check-conflict', 'Handwritten check or composition logic competes with the authored change.', desired.path, actual.body.getStart(), actual.body.end - actual.body.getStart()));
    else edits.replaceSyntax(desired.path, text, actual.body.getStart(), actual.body.end, next.body.getText());
  }
  return { text: edits.source(desired.path, text), problems: [...problems, ...edits.problems] };
}
