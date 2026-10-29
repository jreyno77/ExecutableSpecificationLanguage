import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IdentityBaseline, ProjectSnapshot } from '../../../../src/index.js';
import { MarkdownPlans } from './markdown-plans.js';

type LegacyFixture = {
  format: 'out27-legacy-markdown-fixture-1';
  source: { sourceId: string; text: string };
  baseline: IdentityBaseline;
  files: { path: string; text: string; sha256: string }[];
};

/** Reopens actual v1 output bytes; the current public adapter must decide whether an upgrade is safe. */
export class MarkdownMigration extends MarkdownPlans {
  legacy!: Readonly<LegacyFixture>;
  static async released(name: 'one-declaration' | 'two-declarations-clean'): Promise<MarkdownMigration> {
    const fixture = JSON.parse(await readFile(new URL('../../../resources/markdown/v1/' + name + '.json', import.meta.url), 'utf8')) as LegacyFixture;
    if (fixture.format !== 'out27-legacy-markdown-fixture-1' || fixture.source.sourceId !== 'fixture.expec') throw Error('Unexpected legacy fixture');
    const caller = new MarkdownMigration();
    caller.legacy = fixture;
    caller.source(fixture.source.text);
    const identified = caller.identity.associate(caller.current.specification, fixture.baseline);
    if (!identified.value || identified.problems.length) throw Error('Legacy identity cannot be reopened: ' + JSON.stringify(identified));
    caller.current = identified.value;
    const compared = caller.identity.compare(fixture.baseline, caller.current);
    if (!compared.value || compared.problems.length) throw Error('Legacy identity cannot be compared: ' + JSON.stringify(compared));
    caller.diff = compared.value;
    for (const file of fixture.files) {
      if (createHash('sha256').update(file.text).digest('hex') !== file.sha256) throw Error('Legacy fixture bytes changed: ' + file.path);
      caller.edit(file.path, file.text);
    }
    const state = JSON.parse(caller.text(caller.statePath()));
    if (state.format !== 1 || state.renderFormat !== 1) throw Error('Expected the original v1 ownership record');
    return caller;
  }
  documents(): string[] { return this.snapshot.files.filter(file => file.path.endsWith('.md')).map(file => file.path).sort(); }
  legacyNotes(name: string, notes: string): void {
    const path = 'docs/' + name + '.md', text = this.text(path);
    const subject = this.legacy.baseline.elements.find(record => record.address.owner === null && record.address.name === name);
    if (!subject) throw Error('No original declaration ' + name);
    const end = '<!-- expec-end:' + Buffer.from(subject.id).toString('hex') + ' -->\n\n';
    const boundary = text.indexOf(end);
    if (boundary < 0) throw Error('Original generated boundary is missing');
    this.edit(path, text.slice(0, boundary + end.length) + notes);
  }
  legacyLink(name: string): string {
    const subject = this.legacy.baseline.elements.find(record => record.address.owner === null && record.address.name === name);
    if (!subject) throw Error('No original declaration ' + name);
    return '[Library](docs/' + name + '.md#expec-' + Buffer.from(subject.id).toString('hex') + ')\n';
  }
}

/** Compares every path, byte and version without depending on snapshot order or Buffer identity. */
export function projectFiles(snapshot: ProjectSnapshot): Readonly<Record<string, { readonly version: string; readonly bytes: readonly number[] }>> {
  if (new Set(snapshot.files.map(file => file.path)).size !== snapshot.files.length) throw Error('A preservation observation contains duplicate paths');
  return Object.fromEntries([...snapshot.files].sort((left, right) => left.path.localeCompare(right.path))
    .map(file => [file.path, { version: file.version, bytes: Array.from(file.bytes) }]));
}