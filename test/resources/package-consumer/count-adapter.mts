import type {
  ArtifactLocator, Check, Diagnostic, OutputAdapter, OutputPlan, OutputRegistration, OutputRequest,
  ProjectRead, ProjectSearch, ProjectSnapshot, SpecIdentifier,
} from 'executable-specification-language';

const outputId = 'declaration-count', format = 'declaration-count-1';
const scope = 'declaration-count report definitions and references';
interface CountDocument { format: string; subjects: { id: string; name: string }[]; references: string[]; title?: string }
const location = (path: string, subject?: string): ArtifactLocator => ({ outputId, format, value: { path, ...(subject ? { subject } : {}) } });
const problem = (message: string, path: string): Diagnostic => ({ code: 'count-output', message,
  at: { kind: 'dependency', path: ['project', path] }, related: [] });

/** A consumer-owned profile: create one report, then read/search its explicit JSON identities. */
class CountAdapter implements OutputAdapter {
  readonly id = outputId;
  private directory: string;
  constructor(directory: string) { this.directory = directory; }
  async plan(request: OutputRequest, basedOn: ProjectSnapshot): Promise<Check<OutputPlan>> {
    const path = this.directory + '/counts.json';
    if (request.operation !== 'create' || !basedOn.complete || basedOn.files.some(file => file.path === path)) {
      return { problems: [problem('This example profile creates a new report in a complete project; it does not replace files.', path)], deferred: [] };
    }
    const inspection = request.current.specification.inspection;
    const concepts = [...inspection.query('concept')], records = [...inspection.query('record-type-declaration')];
    const capabilities = [...inspection.query('capability')];
    const subjects = [...concepts, ...records, ...capabilities].map(item => ({ id: request.current.id(item.id), name: item.name }));
    return { value: { outputId, basedOn, changes: [{ kind: 'write', path, bytes: new TextEncoder().encode(JSON.stringify({
      format, concepts: concepts.length, recordTypes: records.length, capabilities: capabilities.length, subjects, references: [],
    }, null, 2) + '\n') }], artifacts: subjects.map(subject => ({ specId: subject.id, locator: location(path, subject.id) })) }, problems: [], deferred: [] };
  }
  async read(id: SpecIdentifier, basedOn: ProjectSnapshot): Promise<ProjectRead> {
    const found = this.documents(basedOn);
    return { artifacts: found.documents.filter(({ data }) => data.subjects.some(subject => subject.id === id))
      .map(({ file }) => ({ at: location(file.path, id), file })), coverage: found.coverage, problems: found.problems };
  }
  async search(id: SpecIdentifier, basedOn: ProjectSnapshot): Promise<ProjectSearch> {
    const { documents, coverage, problems } = this.documents(basedOn);
    const definitions = documents.filter(({ data }) => data.subjects.some(subject => subject.id === id));
    return { definitions: definitions.map(({ file }) => location(file.path, id)), problems,
      incoming: { subject: id, direction: 'incoming', coverage, unresolved: [],
        uses: documents.filter(({ data }) => data.references.includes(id)).map(({ file, data }) => ({
          target: { kind: 'project', id: data.title ?? file.path }, at: location(file.path),
        })) },
      outgoing: { subject: id, direction: 'outgoing', coverage, unresolved: [],
        uses: definitions.flatMap(({ file, data }) => data.references.map(target => ({
          target: { kind: 'specified', id: target }, at: location(file.path),
        }))) },
    };
  }
  private documents(snapshot: ProjectSnapshot) {
    const problems: Diagnostic[] = [], documents: { file: ProjectSnapshot['files'][number]; data: CountDocument }[] = [];
    for (const file of snapshot.files.filter(file => file.path.endsWith('/counts.json') || file.path.endsWith('.counts.json'))) {
      try {
        const data = JSON.parse(new TextDecoder().decode(file.bytes)) as CountDocument;
        if (data.format !== format || !Array.isArray(data.subjects) || !Array.isArray(data.references)
          || data.subjects.some(subject => !subject || typeof subject.id !== 'string' || typeof subject.name !== 'string')
          || data.references.some(id => typeof id !== 'string')) throw Error('Invalid count document');
        documents.push({ file, data });
      } catch { problems.push(problem('Cannot inspect this count document.', file.path)); }
    }
    const limitations = [...(!snapshot.complete ? ['Project capture is incomplete.'] : []), ...problems.map(item => item.message)];
    return { documents, problems, coverage: { scope: [{ outputId, format, value: scope }], complete: !limitations.length, limitations } };
  }
}

export const countOutput: OutputRegistration = {
  id: outputId,
  validate: options => Object.keys(options).length === 1 && typeof options.directory === 'string' && /^[a-z][a-z0-9-]*$/.test(options.directory)
    ? [] : [{ path: ['directory'], message: 'This example accepts one literal directory name.' }],
  open: options => new CountAdapter(options.directory as string),
};
