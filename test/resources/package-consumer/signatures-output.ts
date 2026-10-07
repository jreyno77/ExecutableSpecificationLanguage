import type { ArtifactLocator, Diagnostic, IdentifiedSpecification, OutputAdapter, OutputRegistration, ProjectFile, ProjectSnapshot, TypeId } from 'executable-specification-language';

/**
 * Independent UTF-8 NDJSON catalog: signature/note/use records have stable IDs.
 * Only top-level primitive function signatures are supported, not executable
 * behavior or native-code search. Exact confirmed signatures are managed; notes
 * retain their bytes. Deletion, defaults, failures and contract bodies refuse.
 */
export const signaturesOutput: OutputRegistration = {
  id: 'signatures',
  validate(options) {
    return Object.keys(options).length === 1 && typeof options.destination === 'string'
      && /^[a-zA-Z0-9_-]+\.ndjson$/.test(options.destination)
      ? [] : [{ path: ['destination'], message: 'Provide one literal .ndjson filename as destination.' }];
  },
  open: options => new Signatures(String(options.destination)),
};
type RecordValue = { kind: 'signature' | 'note'; id: string; text: string } | { kind: 'use'; id: string };
type Row = { value: RecordValue; file: ProjectFile; line: number; start: number; end: number; raw: string };
const encoder = new TextEncoder();
const at = (file: string, id: string, line: number, start: number, end: number): ArtifactLocator =>
  ({ outputId: 'signatures', format: 'signatures-record-1', value: { file, id, line, start, end } });
const problem = (code: string, message: string, file: string, line = 1): Diagnostic =>
  ({ code, message, at: { kind: 'dependency', path: ['signatures', file, line] }, related: [] });
const location = (row: Row) => at(row.file.path, row.value.id, row.line, row.start, row.end);
const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => byte === right[index]);

/** Only this extension's grammar is parsed, with current UTF-16 line spans. */
function records(snapshot: ProjectSnapshot, destination: string) {
  const rows: Row[] = [], problems: Diagnostic[] = [], definitions = new Map<string, Row>();
  const files = snapshot.files.filter(file => file.path.endsWith('.ndjson'));
  for (const file of files) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
    catch { problems.push(problem('invalid-signatures', 'Format input must be UTF-8.', file.path)); continue; }
    let start = 0, line = 0;
    for (const raw of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
      if (!raw) continue;
      line++;
      const body = raw.replace(/\r?\n$/, '');
      try {
        const value: unknown = JSON.parse(body);
        if (!value || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)
          || !('id' in value) || typeof value.id !== 'string' || !value.id.trim()
          || (value.kind !== 'use' && value.kind !== 'signature' && value.kind !== 'note')
          || (value.kind === 'use' ? Object.keys(value).sort().join(',') !== 'id,kind'
            : Object.keys(value).sort().join(',') !== 'id,kind,text' || !('text' in value) || typeof value.text !== 'string'))
          throw Error('Expected a signature, note or use record with a nonblank string ID.');
        const row = { value: value as RecordValue, file, line, start, end: start + body.length, raw };
        rows.push(row);
        if (row.value.kind === 'signature') {
          const before = definitions.get(row.value.id);
          if (before) problems.push({ ...problem('ambiguous-signature', 'Two records define ' + row.value.id + '.', file.path, line),
            related: [problem('', '', before.file.path, before.line).at] });
          else definitions.set(row.value.id, row);
        }
      } catch (error) { problems.push(problem('invalid-signatures', String(error), file.path, line)); }
      start += raw.length;
    }
  }
  const limitations = [...(!snapshot.complete ? ['The supplied project capture is incomplete.'] : []), ...problems.map(item => item.message)];
  const coverage = { scope: [...new Set([destination, ...files.map(file => file.path)])].map(file =>
    ({ outputId: 'signatures', format: 'signatures-format-1', value: { format: 'ndjson', file } })),
    complete: limitations.length === 0, limitations };
  return { rows, problems, coverage };
}

function signatures(current: IdentifiedSpecification) {
  const { inspection, types } = current.specification;
  const problems: Diagnostic[] = [], rows: Extract<RecordValue, { text: string }>[] = [];
  const unsupported = (item: { origin: Diagnostic['at'] }, message: string) =>
    problems.push({ code: 'unsupported-signatures', message, at: item.origin, related: [] });
  const interactions = [...inspection.query('interaction')].filter(item => item.origin.kind === 'source');
  if (interactions.length) {
    for (const item of interactions) unsupported(item, 'This signature catalog cannot represent an interaction.');
    return { rows, problems };
  }
  const typeName = (id: TypeId): string | undefined => {
    const type = types.describe(id);
    if (type.kind !== 'builtin' || type.arguments.length) return undefined;
    const declaration = inspection.read(type.declaration, 'builtin-type');
    return ['Text', 'Number', 'Boolean'].includes(declaration.name) ? declaration.name : undefined;
  };
  for (const item of inspection.roots()) {
    if (item.origin.kind !== 'source') continue;
    if (item.kind !== 'function') { unsupported(item, 'Only top-level function signatures are supported.'); continue; }
    const callable = types.callable(item.id), parameters: string[] = [];
    let valid = !callable.failures.length && item.body.kind === 'absent';
    for (const parameter of callable.parameters) {
      const declaration = inspection.read(parameter.declaration, 'parameter');
      const name = parameter.type.status === 'known' ? typeName(parameter.type.value) : undefined;
      if (!name || declaration.hasDefault) valid = false;
      else parameters.push(declaration.name + ': ' + name);
    }
    const result = callable.result.status === 'known' ? callable.result.value : undefined;
    const resultName = result?.kind === 'none' ? 'Nothing' : result?.kind === 'value' ? typeName(result.type) : undefined;
    if (!valid || !resultName) { unsupported(item, 'Provide primitive parameters, an explicit primitive/Nothing result, and no defaults, failures or body.'); continue; }
    rows.push({ kind: 'signature', id: current.id(item.id), text: item.name + '(' + parameters.join(', ') + ') returns ' + resultName });
  }
  return { rows, problems };
}

class Signatures implements OutputAdapter {
  readonly id = 'signatures';
  constructor(private readonly destination: string) {}
  async plan(request: Parameters<OutputAdapter['plan']>[0], basedOn: ProjectSnapshot) {
    const fail = (problems: Diagnostic[]) => ({ problems, deferred: [] });
    if (!basedOn.complete) return fail([...basedOn.problems, problem('incomplete-signatures', 'A complete capture is required.', this.destination)]);
    if (request.operation === 'delete') return fail([problem('unsupported-signatures', 'This example does not delete signatures.', this.destination)]);
    const desired = signatures(request.current);
    if (desired.problems.length) return fail(desired.problems);
    const existing = records(basedOn, this.destination);
    if (existing.problems.length) return fail(existing.problems);
    const owned = request.current.baseline.artifacts.filter(row => row.locator.outputId === this.id && row.locator.format === 'signatures-record-1');
    for (const row of existing.rows.filter(row => row.file.path === this.destination && row.value.kind !== 'note')) {
      const confirmed = owned.some(link => {
        const value = link.locator.value;
        return value && typeof value === 'object' && !Array.isArray(value) && 'file' in value && value.file === this.destination
          && link.specId === row.value.id && 'text' in value && value.text === ('text' in row.value ? row.value.text : undefined);
      });
      if (!confirmed || !desired.rows.some(next => next.id === row.value.id))
        return fail([problem('signature-conflict', 'Existing signatures require exact confirmed ownership; deletion is unsupported.', row.file.path, row.line)]);
    }
    const text = desired.rows.map(row => JSON.stringify(row) + '\n').join('')
      + existing.rows.filter(row => row.file.path === this.destination && row.value.kind === 'note').map(row => row.raw).join('');
    const bytes = encoder.encode(text), previous = basedOn.files.find(file => file.path === this.destination);
    const artifacts = desired.rows.map(row => ({ specId: row.id, locator: {
      outputId: this.id, format: 'signatures-record-1', value: { file: this.destination, id: row.id, text: row.text },
    } }));
    return { value: { outputId: this.id, basedOn, changes: previous && sameBytes(previous.bytes, bytes) ? []
      : [{ kind: 'write' as const, path: this.destination, bytes }], artifacts }, problems: [], deferred: [] };
  }
  async read(id: string, basedOn: ProjectSnapshot) {
    const view = records(basedOn, this.destination), selected = new Map<string, Row>();
    for (const row of view.rows) if (row.value.id === id && row.value.kind !== 'use') selected.set(row.file.path, row);
    return { artifacts: [...selected.values()].map(row => ({ at: location(row), file: row.file })), coverage: view.coverage, problems: view.problems };
  }
  async search(subject: string, basedOn: ProjectSnapshot) {
    const view = records(basedOn, this.destination);
    return { definitions: view.rows.filter(row => row.value.kind === 'signature' && row.value.id === subject).map(location),
      incoming: { subject, direction: 'incoming' as const, coverage: view.coverage,
        uses: view.rows.filter(row => row.value.kind === 'use' && row.value.id === subject).map(row => ({ target: { kind: 'project' as const, id: row.file.path }, at: location(row) })), unresolved: [] },
      outgoing: { subject, direction: 'outgoing' as const, coverage: view.coverage, uses: [], unresolved: [] }, problems: view.problems };
  }
}
