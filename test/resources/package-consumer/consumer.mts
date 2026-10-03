import {
  Compiler, SpecificationIdentity, type CompilationInput, type Compilation, type Specification,
  type Inspection, type Item, type IdentityBaseline, type SpecDiff, type Check,
  FileProjectWriter, type ProjectWriter, type ProjectContext, type FileChange, type FileObservation, type WriteResult,
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

export async function writeProject(context: ProjectContext): Promise<WriteResult> {
  const writer: ProjectWriter = new FileProjectWriter(context);
  const changes: FileChange[] = [{ kind: 'write', path: 'book.txt', bytes: new TextEncoder().encode('book') }];
  const result = await writer.apply({ basedOn: await context.readSnapshot(), changes });
  const observation: FileObservation | undefined = result.outcomes[0]?.after[0];
  return result;
}

let issued = 0;
const identities = new SpecificationIdentity(() => 'consumer-' + ++issued);
const identified = compilation.value ? identities.associate(compilation.value) : undefined;
export const baseline: IdentityBaseline | undefined = identified?.value?.baseline;
export const changes: Check<SpecDiff> | undefined = identified?.value
  ? identities.compare(undefined, identified.value) : undefined;
export const saved = baseline ? identities.write(baseline) : undefined;
export const restored = saved?.value
  ? identities.read({ sourceId: '.expec/identity.json', text: saved.value }) : undefined;
