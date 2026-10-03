import {
  Compiler, type CompilationInput, type Compilation, type Specification,
  type Inspection, type Item, type Check, type NodeId, type ScenarioCapture, type ScenarioStep,
} from 'executable-specification-language';

const input: CompilationInput = {
  source: { sourceId: 'consumer.expec', text: 'concept StoreGame { capability saveGame(snapshot: Text) returns Nothing }' },
  locator: 'consumer', dependencies: { modules: [], packages: [] },
};
const compilation: Compilation = new Compiler().compile(input);

function capabilities(specification: Specification): readonly Item<'capability'>[] {
  const inspection: Inspection = specification.inspection;
  return [...inspection.query('capability')];
}

export const capabilityNames: readonly string[] = compilation.value
  ? capabilities(compilation.value).map(capability => capability.name) : [];

export function checkedOperations(specification: Specification): readonly Check<NodeId>[] {
  return [...specification.inspection.query('call-expression')].map(call => specification.call(call.id));
}
export function capturedValues(specification: Specification): readonly ScenarioCapture[] {
  return [...specification.inspection.query('when')].flatMap(step => {
    const result: Check<ScenarioStep> = specification.step(step.id);
    return result.value ? [...result.value.available, ...result.value.capture ? [result.value.capture] : []] : [];
  });
}
