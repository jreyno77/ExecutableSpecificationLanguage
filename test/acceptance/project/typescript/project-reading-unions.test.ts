import { it } from 'vitest';
import { ProjectReading } from '../../../dsl/project/typescript/project-reading.js';

it('keeps unrelated known union fields out of a saving reference search', async () => {
  const project = await ProjectReading.create();
  await project.files({ 'store.ts': `export class Store { save() { return 1; } }
type Origin = { kind: 'source'; line: number } | { kind: 'external'; module: string };
export function describe(origin: Origin) { return origin.kind; }
export function launch() { return new Store().save(); }` });
  project.associateSymbol('save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
  await project.search('save');
  project.expectSearchCompleteWithinDeclaredScope();
  project.expectIncomingAt({ file: 'store.ts', text: 'save', within: 'new Store().save()', role: 'call' });
  project.expectProjectAndAssociationsUnchanged();
});

it('keeps unrelated known destructured fields out of a saving reference search', async () => {
  const project = await ProjectReading.create();
  await project.files({ 'store.ts': `export class Store { save() { return 1; } }
type Origin = { kind: 'source'; line: number } | { kind: 'external'; module: string };
export function describe(origin: Origin) { const { kind } = origin; return kind; }` });
  project.associateSymbol('save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
  await project.search('save');
  project.expectSearchCompleteWithinDeclaredScope();
  project.expectIncomingUses([]);
});

it('retains an ambiguous union call that could target the selected saving method', async () => {
  const project = await ProjectReading.create();
  await project.files({ 'store.ts': `export class Store { save() { return 1; } }
export class Other { save() { return 2; } }
export function persist(receiver: Store | Other) { return receiver.save(); }` });
  project.associateSymbol('save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
  await project.search('save');
  project.expectIncomingIncomplete();
  project.expectIncomingUnresolvedAt('store.ts', 'receiver.save');
});
