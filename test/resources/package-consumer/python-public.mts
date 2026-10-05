import { runCli, PythonContext, PythonProject, ProjectInitializer, pythonOutput, pythonAcceptanceOutput,
  type Configuration, type ProjectContext, type ArtifactAssociation, type ProjectRead, type ProjectSearch,
  type OutputRegistration } from 'executable-specification-language';

export async function publicPython(project: ProjectContext, configuration: Configuration,
  associations: readonly ArtifactAssociation[], python: string, uv: string): Promise<void> {
  const context = new PythonContext(project, { configFile: 'expec.python.json' });
  const snapshot = await context.readSnapshot();
  const query = new PythonProject({ outputId: 'python' }, associations);
  const read: ProjectRead = await query.read('store', snapshot);
  const search: ProjectSearch = await query.search('store', snapshot);
  const registrations: OutputRegistration[] = [pythonOutput, pythonAcceptanceOutput];
  await new ProjectInitializer('/consumer/spec/expec.json', configuration).prepare({ root: '../project', target: 'python', python, uv });
  const code: number = await runCli(['--version'], { contracts: registrations });
  void [read, search, code];
}
