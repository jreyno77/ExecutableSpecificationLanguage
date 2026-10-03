import {
  Compiler, type CompilationInput, type Compilation, type Specification,
  type Inspection, type Item,
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
