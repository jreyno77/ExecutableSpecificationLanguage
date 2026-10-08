import { isDeepStrictEqual } from 'node:util';
import type { ArtifactAssociation, SpecIdentifier } from '../../model/specification-identity.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ProjectRead, ProjectSearch } from '../connection/project-inspection.js';
import { z } from 'zod';
import { canonical, identifier, jsonData, locatorSchema } from '../../model/identity-baseline.js';
import { TypeScriptCapture, diagnostic, pathValid, requireInput, validateSnapshot } from './typescript-capture.js';
import { TypeScriptSymbols, unique, type Selector } from './typescript-symbols.js';

export interface TypeScriptProjectOptions { readonly outputId: string; readonly configFile?: string }

/** Queries the exact supplied project capture through native TypeScript symbols. */
export class TypeScriptProject {
  private readonly options: TypeScriptProjectOptions;
  private readonly associations: readonly ArtifactAssociation[];
  private readonly libraries = new Map<string, string>();
  private retained: TypeScriptCapture | undefined;
  constructor(options: TypeScriptProjectOptions, associations: readonly ArtifactAssociation[]) {
    const settings = z.strictObject({ outputId: z.string().trim().min(1), configFile: z.string().refine(pathValid).optional() });
    requireInput(jsonData(options) && settings.safeParse(options).success, 'Provide an output ID and optional exact project-relative configuration path.');
    requireInput(jsonData(associations) && z.array(z.strictObject({ specId: identifier, locator: locatorSchema })).safeParse(associations).success, 'Provide finite artifact associations.');
    requireInput(new Set(associations.map(item => canonical(item.locator))).size === associations.length, 'Duplicate exact association locator.');
    const selected = associations.filter(item => item.locator.outputId === options.outputId);
    for (const { locator } of selected) {
      if (!['typescript-symbol-1', 'typescript-file-1'].includes(locator.format)) continue;
      const value = locator.value as unknown as { file: string; declaration?: Selector[] };
      requireInput(value && !Array.isArray(value) && pathValid(value.file)
        && Object.keys(value).every(key => ['file', ...(locator.format === 'typescript-symbol-1' ? ['declaration'] : [])].includes(key)), 'Use exact project-relative TypeScript association paths.');
      if (locator.format === 'typescript-symbol-1') requireInput(Array.isArray(value.declaration) && value.declaration.length && value.declaration.every((part, index, parts) => {
        const member = parts[index - 1]?.kind === 'class' && ['method', 'property', 'accessor'].includes(part?.kind);
        return part && ['namespace', 'class', 'interface', 'type', 'enum', 'function', 'variable', 'method', 'property', 'accessor', 'constructor'].includes(part.kind)
          && typeof part.name === 'string' && !!part.name && (part.kind !== 'constructor' || part.name === 'constructor')
          && Object.keys(part).every(key => ['kind', 'name', ...(member ? ['static'] : [])].includes(key)) && (!member || typeof part.static === 'boolean');
      }), 'Use a nonempty lexical declaration path with explicit static class-member selection.');
    }
    this.options = structuredClone(options); this.associations = structuredClone(selected);
  }
  private prepare(snapshot: ProjectSnapshot): TypeScriptCapture {
    try {
      validateSnapshot(snapshot);
      if (this.retained && sameCapture(this.retained.snapshot, snapshot)) return this.retained;
      this.retained?.service.dispose(); this.retained = undefined;
      const capture = new TypeScriptCapture(snapshot, this.options.outputId, this.options.configFile, this.libraries);
      if (!capture.problems.length) this.retained = capture;
      return capture;
    } catch (error) {
      this.retained?.service.dispose(); this.retained = undefined; throw error;
    }
  }
  private query(id: SpecIdentifier, basedOn: ProjectSnapshot) {
    requireInput(identifier.safeParse(id).success, 'Provide a specification identifier.');
    const capture = this.prepare(basedOn);
    try {
      const symbols = new TypeScriptSymbols(capture, this.associations);
      const associated = this.associations.filter(item => item.specId === id), problems = [...capture.problems, ...symbols.problems];
      if (!associated.length) problems.push(diagnostic('unassociated-subject', 'No association for this subject exists in this output namespace.', '<associations>'));
      for (const { locator } of associated) {
        if (!['typescript-symbol-1', 'typescript-file-1'].includes(locator.format)) problems.push(diagnostic('unsupported-project-locator', 'This locator is not a TypeScript declaration or companion-file address.', '<associations>'));
        else if (!capture.snapshot.files.some(file => file.path === (locator.value as { file: string }).file)) problems.push(diagnostic('missing-project-artifact', 'Associated project file is absent.', (locator.value as { file: string }).file));
      }
      return { capture, symbols, associated, problems: unique(problems) };
    } catch (error) { if (this.retained === capture) this.retained = undefined; capture.service.dispose(); throw error; }
  }
  read(id: SpecIdentifier, basedOn: ProjectSnapshot): ProjectRead {
    const { capture, symbols, associated, problems } = this.query(id, basedOn);
    try {
      const locations = [...associated.map(item => item.locator), ...symbols.definitions(id)];
      const artifacts = locations.flatMap(at => {
        const path = at.value && typeof at.value === 'object' && 'file' in at.value ? at.value.file : undefined;
        const file = capture.snapshot.files.find(file => file.path === path); return file ? [{ at, file }] : [];
      });
      return structuredClone({ artifacts: unique(artifacts), coverage: { scope: capture.scope(), complete: !problems.length, limitations: problems.map(problem => problem.message) }, problems });
    } finally { if (this.retained !== capture) capture.service.dispose(); }
  }
  search(id: SpecIdentifier, basedOn: ProjectSnapshot): ProjectSearch {
    const { capture, symbols, problems } = this.query(id, basedOn);
    try {
      if (!symbols.selected(id).length) problems.push(diagnostic('missing-symbol-association', 'Search needs an available native symbol association.', '<associations>'));
      const uses = symbols.relationships(id), scope = capture.scope();
      const observation = (direction: 'incoming' | 'outgoing') => ({ subject: id, direction, ...uses[direction], coverage: { scope,
        complete: !problems.length && !uses[direction].unresolved.length, limitations: [...new Set([...problems.map(problem => problem.message), ...uses[direction].unresolved.map(item => item.reason)])] } });
      return structuredClone({ definitions: symbols.definitions(id), incoming: observation('incoming'), outgoing: observation('outgoing'), problems });
    } finally { if (this.retained !== capture) capture.service.dispose(); }
  }
}

function sameCapture(left: ProjectSnapshot, right: ProjectSnapshot): boolean {
  const bodies = (a: ProjectSnapshot['files'], b: ProjectSnapshot['files']) => a.length === b.length && a.every((file, index) => {
    const other = b[index]!;
    return Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength)
      .equals(Buffer.from(other.bytes.buffer, other.bytes.byteOffset, other.bytes.byteLength));
  });
  if (!bodies(left.files, right.files) || !bodies(left.readOnlyFiles ?? [], right.readOnlyFiles ?? [])) return false;
  const metadata = (snapshot: ProjectSnapshot) => {
    const file = ({ bytes: _bytes, ...fields }: ProjectSnapshot['files'][number]) => fields;
    return structuredClone({ ...snapshot, files: snapshot.files.map(file),
      ...(snapshot.readOnlyFiles === undefined ? {} : { readOnlyFiles: snapshot.readOnlyFiles.map(file) }) });
  };
  return isDeepStrictEqual(metadata(left), metadata(right));
}
