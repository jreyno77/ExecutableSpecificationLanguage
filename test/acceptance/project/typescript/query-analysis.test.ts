import { afterEach, describe, it } from 'vitest';
import { QueryAnalysis } from '../../../dsl/project/typescript/query-analysis.js';

afterEach(() => QueryAnalysis.clean());

describe('successive TypeScript project questions', () => {
  it('prepares unchanged meaning once for declaration and relationship questions', async () => {
    const project = new QueryAnalysis({
      'store.ts': 'export class Store { save() {} }',
      'run.ts': 'import { Store } from "./store.js"; new Store().save();',
    });
    project.selectClass('store', 'store.ts', 'Store');
    project.selectMethod('save', 'store.ts', 'Store', 'save');
    project.observePreparation();

    await project.read('store');
    project.expectCompleteRead();
    project.expectReadFile('store.ts', 'export class Store { save() {} }');
    await project.search('save');
    project.expectCompleteSearch();
    project.expectIncomingCall('run.ts', 'save');
    await project.read('save');
    project.expectCompleteRead();

    project.expectPreparations(1);
  });

  it('reuses meaning through the same opened output after real contract generation', async () => {
    const project = await QueryAnalysis.connected('class Store { public save\ncapability save() returns Nothing }');
    project.observePreparation();

    await project.read('Store');
    project.expectCompleteRead();
    await project.search('Store.save');
    project.expectCompleteSearch();
    project.expectDefinition('src/Store.ts');
    await project.read('Store.save');
    project.expectCompleteRead();

    await project.expectOutputUnchanged();
    project.expectPreparations(1);
  });

  it('uses changed ownership associations instead of an earlier output answer', async () => {
    const project = await QueryAnalysis.connected('class Store { public save\ncapability save() returns Nothing }');
    await project.read('Store');
    project.expectCompleteRead();

    await project.relocateSavedDeclaration('src/Absent.ts');
    await project.read('Store');

    project.expectProblem('missing-project-artifact', 'src/Absent.ts');
    project.expectNoReadArtifact('src/Store.ts');
  });
});
