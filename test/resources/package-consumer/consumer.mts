import {
  Compiler, TypeScriptContext, TypeScriptProject, Outputs, umlOutput, markdownOutput, typescriptOutput, acceptanceOutput, SpecificationIdentity, type CompilationInput, type Compilation, type Specification,
  type OutputRegistration, type OutputWrite,
  ProjectInitializer, type InitializationPlan, type InitializationResult,
  LibraryLoader, NpmDependencies, type LibraryLoad, type PackageRead,
  type Inspection, type Item, type IdentityBaseline, type SpecDiff, type Check,
  SourceLoader, SourceComposer, type Configuration, type SourceLoad, type LoadedSources, type SourceCapture,
  FileProjectWriter, type ProjectWriter, type ProjectContext, type FileChange, type FileObservation, type WriteResult,
  type NodeId, type ScenarioCapture, type ScenarioStep,
  TestOperationChecker, ExpressionChecker, FixtureChecker, type TestOperationChecking,
} from 'executable-specification-language';

export const acceptanceRegistration: OutputRegistration = acceptanceOutput;
export function remainingTestWork(write: OutputWrite): readonly string[] { return (write.obligations ?? []).map(item => item.message); }

export async function acquire(manifest: string, root: string, configuration: Configuration) {
  const libraries: LibraryLoad = await new LibraryLoader(manifest).load(configuration);
  const packages: PackageRead = await new NpmDependencies(root).read(configuration.packages);
  return { libraries, packages };
}

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

export async function captureNative(context: ProjectContext): Promise<import('executable-specification-language').ProjectSnapshot> {
  const native: ProjectContext = new TypeScriptContext(context, { configFile: 'tsconfig.json', imports: ['vitest'] });
  const snapshot = await native.readSnapshot();
  const evidence: readonly import('executable-specification-language').ProjectFile[] = snapshot.readOnlyFiles ?? [];
  return snapshot;
}

export async function writeProject(context: ProjectContext): Promise<WriteResult> {
  const writer: ProjectWriter = new FileProjectWriter(context);
  const changes: FileChange[] = [{ kind: 'write', path: 'book.txt', bytes: new TextEncoder().encode('book') }];
  const result = await writer.apply({ basedOn: await context.readSnapshot(), changes });
  const observation: FileObservation | undefined = result.outcomes[0]?.after[0];
  return result;
}

export async function writeWithNativeEvidence(context: ProjectContext, uri: string, version: string): Promise<WriteResult> {
  const snapshot: import('executable-specification-language').ProjectSnapshot = {
    ...await context.readSnapshot(), nativeInputs: [{ uri, version }],
  };
  const captured: readonly { readonly uri: string; readonly version: string }[] = snapshot.nativeInputs ?? [];
  return new FileProjectWriter(context).apply({ basedOn: snapshot, changes: [] });
}

export function checkedOperations(specification: Specification): readonly Check<NodeId>[] {
  return [...specification.inspection.query('call-expression')].map(call => specification.call(call.id));
}
export function checkTestOperations(specification: Specification): readonly Check[] {
  const expressions = new ExpressionChecker(specification.types);
  const checker: TestOperationChecking = new TestOperationChecker(specification.types, expressions, new FixtureChecker(specification.types, expressions));
  return [...specification.inspection.query('check')].map(operation => checker.check(operation.id));
}
export function capturedValues(specification: Specification): readonly ScenarioCapture[] {
  return [...specification.inspection.query('when')].flatMap(step => {
    const result: Check<ScenarioStep> = specification.step(step.id);
    return result.value ? [...result.value.available, ...result.value.capture ? [result.value.capture] : []] : [];
  });
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

export async function loadSources(manifestLocation: string, configuration: Configuration): Promise<SourceLoad> {
  const loaded = await new SourceLoader(manifestLocation).load(configuration, { modules: [], packages: [] });
  const captures: readonly SourceCapture[] = loaded.captures;
  const sources: LoadedSources | undefined = loaded.value;
  if (sources) for (const { entry, dependencies } of sources.entries) {
    new Compiler().compile({ resolution: new SourceComposer(sources.locate).compose(entry, dependencies) });
  }
  return { ...loaded, captures };
}

export function describeFailures(specification: Specification, operation: NodeId): readonly import('executable-specification-language').TypeFact<import('executable-specification-language').ErrorDescription>[] {
  return specification.types.callable(operation).failures.map(fact => fact.status === 'known' ? specification.types.error(fact.value) : fact);
}

const diagrams = new Outputs();
diagrams.register(umlOutput);
export const diagramProfiles = diagrams.profiles;

export function readNativeProject(snapshot: import('executable-specification-language').ProjectSnapshot,
  associations: readonly import('executable-specification-language').ArtifactAssociation[]) {
  const reader = new TypeScriptProject({ outputId: 'typescript' }, associations);
  const read: import('executable-specification-language').ProjectRead = reader.read('store', snapshot);
  const search: import('executable-specification-language').ProjectSearch = reader.search('store', snapshot);
  return { read, search };
}

export function documentationProfiles() {
  const outputs = new Outputs();
  outputs.register(markdownOutput);
  return outputs.profiles;
}

export async function initializeProject(manifest: string, configuration: Configuration): Promise<InitializationResult | undefined> {
  const initializer = new ProjectInitializer(manifest, configuration);
  const preview: Check<InitializationPlan> = await initializer.prepare({ root: 'chosen-game', target: 'typescript' });
  return preview.value ? initializer.apply(preview.value, true) : undefined;
}

export function openTypeScriptOutput(project: ProjectContext, context: import('executable-specification-language').OutputContext) {
  const outputs = new Outputs();
  outputs.register(typescriptOutput);
  return outputs.open('typescript', { directory: 'src' }, project, new FileProjectWriter(project), context);
}

export function compileWorkspace(sources: LoadedSources): Compilation {
  return new Compiler().compile({ resolution: new SourceComposer(sources.locate).compose(sources.entries) });
}
