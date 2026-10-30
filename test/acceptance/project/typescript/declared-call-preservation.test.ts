import { it } from 'vitest';
import { PreservationExamples } from '../../../dsl/project/typescript/typescript-preservation.js';

it('retains a declared call contract and preserves a handwritten addition on regeneration', async () => {
  const source = `class Transformer {
  public transform
  capability transform(value: Number) returns Number
}
class Calculator {
  public add
  capability add(value: Number) returns Number {
    calls Transformer.transform
    promises "Returns the transformed sum"
  }
}`;
  const project = await PreservationExamples.generated(source);
  project.expectOwnedDocumentation('Calculator.add', 'calls Transformer.transform');
  project.expectSourceContains('Not implemented: Calculator.add');
  await project.implement('Calculator.add', '{ return 42; }');
  await project.rememberImplementation(['Calculator.add']);
  project.change(source.replace('Returns the transformed sum', 'Returns the sum of transformed inputs'));
  await project.update();
  project.expectApplied();
  project.expectOwnedDocumentation('Calculator.add', 'calls Transformer.transform');
  project.expectOwnedDocumentation('Calculator.add', 'Returns the sum of transformed inputs');
  await project.expectImplementationBytesKept();
  project.expectImplementation('Calculator.add', '{ return 42; }');
}, 30_000);
