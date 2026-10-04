import ts from 'typescript';
import type { Check } from './checking.js';
import type { OutputPlan } from './output.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import type { AcceptanceOptions } from './acceptance-bindings.js';
import { acceptanceStatePath, testIdentities, type AcceptanceState } from './acceptance-state.js';
import { AcceptanceDocuments } from './acceptance-documents.js';
import { canonical, failure, success } from './identity-baseline.js';
import { hash } from './project-files.js';
import { tokens } from './typescript-edits.js';

/** Removes only verified generated callbacks/files, leaving shared native implementations intact. */
export function removeAcceptance(id: string, snapshot: ProjectSnapshot, options: AcceptanceOptions, previous?: AcceptanceState): Check<OutputPlan> {
  if (!previous) return failure('output-not-found', 'No acceptance ownership exists.');
  const owner = previous.files.find(file => file.artifacts.some(item => item.specId === id));
  if (!owner) return previous.deleted.includes(id)
    ? success({ outputId: 'acceptance', basedOn: snapshot, changes: [], artifacts: previous.files.flatMap(file => file.artifacts) })
    : failure('output-not-found', 'No acceptance artifact exists for this identity.');
  const association = owner.artifacts.find(item => item.specId === id)!;
  if (!['typescript-file-1', 'vitest-test-1'].includes(association.locator.format)) return failure('nested-delete', 'Remove operations through an explicit specification update.');
  const documents = new AcceptanceDocuments(snapshot, options, previous);
  try {
    const search = documents.search(id);
    if (search.problems.length || !search.incoming.coverage.complete) return { problems: search.problems.length ? search.problems
      : [{ code: 'incomplete-native-references', message: search.incoming.coverage.limitations.join('; '), at: { kind: 'dependency', path: [owner.path] }, related: [] }], deferred: [] };
    const original = snapshot.files.find(file => file.path === owner.path)!, text = new TextDecoder().decode(original.bytes), changes: FileChange[] = [];
    const next = structuredClone(previous), file = next.files.find(file => file.path === owner.path)!;
    if (association.locator.format === 'typescript-file-1') {
      if (tokens(text, true) !== tokens(owner.generated, true)) return failure('handwritten-removal', 'The generated file contains handwritten work.', [owner.path]);
      changes.push({ kind: 'remove', path: owner.path }); next.files = next.files.filter(file => file.path !== owner.path);
      next.deleted.push(...owner.artifacts.map(item => item.specId));
    } else {
      const actual = documents.tests.find(test => test.id === id)!.call.parent as ts.ExpressionStatement;
      const source = ts.createSourceFile(owner.path, owner.generated, ts.ScriptTarget.Latest, true), baseline = source.statements.find(statement => testIdentities(statement).includes(id));
      if (!baseline || tokens(actual.getFullText(), true) !== tokens(baseline.getFullText(), true)) return failure('handwritten-removal', 'The generated callback contains handwritten work.', [owner.path]);
      const bytes = Buffer.from(text.slice(0, actual.pos) + text.slice(actual.end));
      changes.push({ kind: 'write', path: owner.path, bytes }); file.confirmed = hash(bytes);
      file.generated = owner.generated.slice(0, baseline.pos) + owner.generated.slice(baseline.end); file.hash = hash(Buffer.from(file.generated));
      file.artifacts = file.artifacts.filter(item => item.specId !== id); next.deleted.push(id);
    }
    next.deleted = [...new Set(next.deleted)].sort();
    changes.push({ kind: 'write', path: acceptanceStatePath, bytes: Buffer.from(canonical(next, 2) + '\n') });
    return success({ outputId: 'acceptance', basedOn: snapshot, changes, artifacts: next.files.flatMap(file => file.artifacts) });
  } finally { documents.close(); }
}
