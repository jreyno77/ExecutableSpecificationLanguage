import { describe, it } from 'vitest';
import { CoherentContractEvidence } from '../../dsl/cli/coherent-contract-evidence.js';

describe('coherent contract evidence before acceptance generation', () => {
  it('inspects every generated subject without reacquiring the project per subject', async () => {
    const project = await CoherentContractEvidence.create();
    await project.projectWithContractsAndExample(
      'type Book {\n  title: Text\n}\n' +
      'component Library {\n  public count\n  capability count() returns Number\n}\n' +
      'function multiply(a: Number, b: Number) returns Number\n' +
      'examples {\n  example "eight squared": multiply(8, 8) => 64\n}\n'
    );

    await project.build();

    project.expectBuilt();
    project.expectInspectedSubjects(['Book', 'Book.title', 'Library', 'Library.count', 'multiply']);
    project.expectCompleteContractCoverage();
    await project.expectTypeField('Book', 'title', 'string');
    await project.expectNativeMethod('Library', 'count', 'number');
    await project.expectGeneratedCall('multiply', [8, 8], 64);
    await project.expectAcceptanceLayers();
    project.expectLiveAcquisitionsInsideContractQueries(0);
  }, 60_000);

  it('refuses a type-valid target edit before tests use earlier contract evidence', async () => {
    const project = await CoherentContractEvidence.create();
    await project.projectWithContractsAndExample(
      'type Book {\n  title: Text\n}\n' +
      'component Library {\n  public count\n  capability count() returns Number\n}\n' +
      'function multiply(a: Number, b: Number) returns Number\n' +
      'examples {\n  example "eight squared": multiply(8, 8) => 64\n}\n'
    );
    project.appendAfterFirstContractQuery('src/Library.ts', '\n// owned concurrent edit\n');

    await project.build();

    project.expectFirstContractQueryCompleted();
    project.expectProblem('stale-project');
    project.expectStage('contracts', 'applied');
    project.expectStage('tests', 'stopped');
    project.expectAppliedContractReceipt('src/Library.ts');
    await project.expectFileEndsWith('src/Library.ts', '\n// owned concurrent edit\n');
    await project.expectNoTestStageEffects();
  }, 60_000);

  it('retains the located editor refusal arriving during a real contract query', async () => {
    const project = await CoherentContractEvidence.create();
    await project.projectWithContractsAndExample(
      'type Book {\n  title: Text\n}\n' +
      'component Library {\n  public count\n  capability count() returns Number\n}\n' +
      'function multiply(a: Number, b: Number) returns Number\n' +
      'examples {\n  example "eight squared": multiply(8, 8) => 64\n}\n'
    );
    project.refuseAfterFirstContractQuery({
      code: 'dirty-editor-buffer',
      message: 'Save the edited Library before generating tests.',
      at: { kind: 'dependency', path: ['editor', 'src/Library.ts'] },
      related: [],
    });

    await project.build();

    project.expectFirstContractQueryCompleted();
    project.expectProblemAt('dirty-editor-buffer', ['editor', 'src/Library.ts']);
    project.expectInspectedQueryCount(1);
    project.expectStage('contracts', 'applied');
    project.expectStage('tests', 'stopped');
    project.expectAppliedContractReceipt('src/Library.ts');
    await project.expectNoTestStageEffects();
  }, 60_000);

  it('keeps completed contract effects visible when the query owner cancels', async () => {
    const project = await CoherentContractEvidence.create();
    await project.projectWithContractsAndExample(
      'type Book {\n  title: Text\n}\n' +
      'component Library {\n  public count\n  capability count() returns Number\n}\n' +
      'function multiply(a: Number, b: Number) returns Number\n' +
      'examples {\n  example "eight squared": multiply(8, 8) => 64\n}\n'
    );
    project.cancelAfterFirstContractQuery();

    await project.build();

    project.expectFirstContractQueryCompleted();
    project.expectProblem('write-cancelled');
    project.expectInspectedQueryCount(1);
    project.expectStage('contracts', 'applied');
    project.expectStage('tests', 'stopped');
    project.expectAppliedContractReceipt('src/Library.ts');
    await project.expectNoTestStageEffects();
  }, 60_000);
});
