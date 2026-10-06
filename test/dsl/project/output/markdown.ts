import { afterEach, expect } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';
import { posix } from 'node:path';
import { MarkdownDriver } from '../../../driver/project/output/markdown.js';

const active = new Set<MarkdownExamples>();
afterEach(async () => { for (const example of active) await example.driver.dispose(); active.clear(); });
const nodes = (text: string): RootContent[] => {
  const result: RootContent[] = [];
  const visit = (node: RootContent): void => { result.push(node); if ('children' in node) node.children.forEach(child => visit(child as RootContent)); };
  fromMarkdown(text).children.forEach(visit); return result;
};
const plain = (text: string): string => nodes(text).filter(node => node.type === 'text' || node.type === 'inlineCode').map(node => node.value).join('');
const codes = (text: string): string[] => nodes(text).flatMap(node => node.type === 'code' ? [node.value] : []);
const line = (text: string, label: string): string => {
  const found = fromMarkdown(text).children.find(node => node.type === 'paragraph' && plain(text.slice(node.position!.start.offset!, node.position!.end.offset!)).startsWith(label + ':'));
  return found ? plain(text.slice(found.position!.start.offset!, found.position!.end.offset!)).slice(label.length + 1).trim() : '';
};

/** Reader actions and independently authored observations over generated/current Markdown. */
export class MarkdownExamples {
  readonly driver = new MarkdownDriver();
  constructor() { active.add(this); }
  source(text: string): void { this.driver.source(text); }
  sourceFile(path: string, text: string): void { this.driver.sourceFile(path, text); }
  package(alias: string, phases: ('build' | 'runtime' | 'test')[]): void { this.driver.packages.push({ alias, phases }); }
  externalFunction(module: string, name: string, parameters: string[], result: string, _body: { body: 'unavailable' }): void { this.driver.externalFunction(module, name, parameters, result); }
  async generate(): Promise<void> { await this.driver.mutate('create'); }
  async generateWith(...ids: string[]): Promise<void> { for (const id of ids) await this.driver.mutate('create', id); }
  async generateFrom(entry: string): Promise<void> { this.driver.entry = entry; await this.generate(); }
  async update(): Promise<void> { await this.driver.mutate('update'); }
  async insert(): Promise<void> { await this.driver.mutate('insert'); }
  renameIdentity(from: string, to: string): void { this.driver.rename(from, to); }
  moveIdentity(from: string, to: string): void { this.driver.rename(from, to); }
  retireIdentity(name: string): void { this.driver.retire(name); }
  preserveIdentityOfExamplesContaining(name: string): void { this.driver.preserveExamples(name); }
  async write(path: string, text: string): Promise<void> { await this.driver.write(path, text); }
  async append(path: string, text: string): Promise<void> { await this.driver.append(path, text); }
  async appendBytes(path: string, bytes: number[]): Promise<void> { await this.driver.append(path, Uint8Array.from(bytes)); }
  async copy(from: string, to: string): Promise<void> { await this.driver.write(to, this.driver.bytes(from)); }
  async replaceFileText(path: string, before: string, after: string): Promise<void> { await this.driver.replace(path, before, after); }
  async replaceNotes(name: string, notes: string): Promise<void> { await this.driver.replaceNotes(name, notes); }
  async appendLinkInNotes(owner: string, label: string, target: string): Promise<void> { await this.driver.linkInNotes(owner, label, target); }
  async removeOutputState(): Promise<void> { await this.driver.removeState(); }
  async read(name: string): Promise<void> { await this.driver.read(name); }
  async search(name: string): Promise<void> { await this.driver.search(name); }
  async searchIn(id: string, name: string): Promise<void> { await this.driver.search(name, id); }
  async delete(name: string): Promise<void> { await this.driver.delete(name); }
  async planUpdate(): Promise<void> { await this.driver.planUpdate(); }
  async applyPlannedChangesWithRealWriter(): Promise<void> { await this.driver.applyPlan(); }
  failActualWriteOfOutputState(): void { this.driver.failStateWrite(); }
  restoreFileWrites(): void { this.driver.restoreWrites(); }
  expectCompactLeaf(name: string, signature: string): void {
    const text = this.section(name);
    expect(text).toMatch(/^<!-- expec-fragment:/);
    expect(nodes(text).some(node => node.type === 'heading')).toBe(false);
    expect(plain(text)).toContain(signature);
    expect(text).toContain('<a id="expec-' + Buffer.from(this.driver.id(name)).toString('hex') + '"></a>');
  }
  async removeActualAnchor(name: string): Promise<void> {
    const anchor = '<a id="expec-' + Buffer.from(this.driver.id(name)).toString('hex') + '"></a>';
    await this.driver.replace(this.driver.fileFor(name), anchor, '');
  }
  async duplicateActualAnchor(name: string): Promise<void> {
    const anchor = '<a id="expec-' + Buffer.from(this.driver.id(name)).toString('hex') + '"></a>';
    await this.driver.replace(this.driver.fileFor(name), anchor, anchor + '\n\n' + anchor);
  }
  private section(name: string, id = 'markdown'): string { return this.driver.section(name, id); }
  private all(): string { return this.driver.paths().filter(path => path.startsWith('docs/specification/') && path.endsWith('.md')).map(path => this.driver.textAt(path)).join('\n'); }
  expectSignatureIn(id: string, name: string, inputs: string[], result: string): void {
    const signature = codes(this.section(name, id))[0];
    expect(signature).toContain(name.split('.').at(-1) + '(' + inputs.join(', ') + ') returns ' + result);
  }
  expectSignature(name: string, inputs: string[], result: string): void { this.expectSignatureIn('markdown', name, inputs, result); }
  expectPromise(name: string, text: string): void { expect(plain(this.section(name))).toContain(text); }
  expectStatus(name: string, status: string): void { expect(plain(this.section(name))).toContain(status); }
  expectResult(name: string, result: string): void { expect(line(this.section(name), 'Result')).toBe(result); }
  expectConstruction(name: string, inputs: string[]): void { expect(codes(this.section(name))).toContain('construction(' + inputs.join(', ') + ')'); }
  expectPackageRequirement(name: string, alias: string, phase: string): void { expect(line(this.section(name), 'Packages')).toBe(alias + ' — ' + phase); }
  expectPublicCapabilities(name: string, capabilities: string[]): void { expect(line(this.section(name), 'Public capabilities')).toBe(capabilities.join(', ')); }
  expectInternalDeclarations(name: string, declarations: string[]): void { expect(line(this.section(name), 'Internal declarations')).toBe(declarations.join(', ')); }
  expectType(name: string, signature: string, fields: string[]): void {
    expect(codes(this.section(name))).toContain(signature + ' {\n' + fields.map(field => '  ' + field).join('\n') + '\n}');
  }
  expectAlias(name: string, signature: string, target: string): void { expect(codes(this.section(name))).toContain('type ' + signature + ' = ' + target); }
  expectOpaque(name: string, status: string): void { expect(plain(this.section(name))).toContain(status); }
  expectConditions(name: string, conditions: string[]): void {
    expect(codes(this.section(name)).flatMap(code => code.split('\n')).filter(line => /^(requires|ensures) /.test(line))).toEqual(conditions);
  }
  expectError(name: string, declared: string[], fields: string[]): void {
    expect(plain(this.section(name))).toContain('Error type');
    expect(line(this.section(name), 'Codes')).toBe(declared.join(', '));
    const actual = codes(this.section(name))[0]!.split('\n').slice(1, -1).map(line => line.trim()).filter(line => !line.startsWith('code:'));
    expect(actual).toEqual(fields);
  }
  expectFailures(name: string, names: string[]): void { expect(line(this.section(name), 'May fail with')).toBe(names.join(', ')); }
  expectFailureStatement(name: string, text: string): void { expect(plain(this.section(name))).toContain(text); }
  private linkExists(text: string, path: string, label: string, target: string): boolean {
    return nodes(text).some(node => {
      if (node.type !== 'paragraph' && node.type !== 'listItem') return false;
      const fragment = text.slice(node.position!.start.offset!, node.position!.end.offset!);
      if (!plain(fragment).includes(label)) return false;
      return nodes(fragment).some(link => {
        if (link.type !== 'link') return false;
        const [file, hash] = link.url.split('#'), actual = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(file!)));
        return hash === 'expec-' + Buffer.from(this.driver.id(target)).toString('hex') && this.driver.paths().includes(actual)
          && this.driver.textAt(actual).includes('<a id="' + hash + '"></a>');
      });
    });
  }
  expectLinkTo(name: string, label: string, target: string): void {
    expect(this.linkExists(this.section(name), this.driver.fileFor(name), label, target)).toBe(true);
  }
  expectCallLink(expression: string, target: string): void {
    expect(this.driver.paths().filter(path => path.endsWith('.md')).some(path => this.linkExists(this.driver.textAt(path), path, expression, target))).toBe(true);
  }
  expectSteps(name: string, steps: string[]): void {
    expect(codes(this.section(name))[0]!.split('\n').filter(line => /^\s*(given|when|then) /.test(line)).map(line => line.trim())).toEqual(steps);
  }
  expectExample(name: string, values: { actual: string; expected: string }): void {
    expect(codes(this.section(name))).toContain('example ' + JSON.stringify(name) + ': ' + values.actual + ' => ' + values.expected);
  }
  expectProse(name: string, text: string): void { expect(plain(this.section(name))).toContain(text); }
  expectStatements(name: string, statements: string[]): void {
    const code = codes(this.section(name))[0]!;
    expect(code.slice(code.indexOf('{') + 1, code.lastIndexOf('}')).trim().split('\n').filter(Boolean).map(line => line.trim())).toEqual(statements);
  }
  expectFixture(name: string, type: string, value: string): void { expect(codes(this.section(name))).toContain('fixture ' + name + ': ' + type + ' = ' + value); }
  expectMessages(name: string, messages: string[]): void {
    const actual = nodes(this.section(name)).filter(node => node.type === 'listItem').map(node =>
      plain(this.section(name).slice(node.children[0]!.position!.start.offset!, node.children[0]!.position!.end.offset!))).filter(text => text.includes(' -> '));
    expect(actual).toEqual(messages);
  }
  expectCapture(name: string, capture: string, type: string): void { expect(line(this.section(name), 'Captures')).toContain(capture + ': ' + type); }
  expectOrigin(name: string, locator: string, lineNumber: number): void { expect(line(this.section(name), 'Source')).toContain(locator + ':' + lineNumber + ':'); }
  expectExternalReference(name: string, locator: string, status: string): void {
    expect(plain(this.all())).toContain(name + ' — ' + locator + ' — ' + status);
  }
  expectDeclarationCount(name: string, count: number): void {
    const marker = this.driver.marker(name);
    expect(this.driver.paths().filter(path => path.startsWith('docs/specification/')).reduce((sum, path) => sum + this.driver.textAt(path).split(marker).length - 1, 0)).toBe(count);
  }
  expectNoDeclaration(name: string): void {
    const id = this.driver.originalIds.get(name)!;
    expect(this.all()).not.toContain('specId":"' + id + '"');
    const owner = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : undefined;
    expect(owner ? this.section(owner) : this.all()).not.toContain('<a id="expec-' + Buffer.from(id).toString('hex') + '"></a>');
  }
  expectFiles(paths: string[]): void { expect(this.driver.paths().filter(path => path.startsWith('docs/specification/') && path.endsWith('.md'))).toEqual([...paths].sort()); }
  expectNoFile(path: string): void { expect(this.driver.paths()).not.toContain(path); }
  expectNoFilesIn(paths: string[]): void { for (const path of paths) expect(this.driver.paths().some(file => file.startsWith(path + '/'))).toBe(false); }
  expectSubjectInFile(name: string, path: string): void { expect(this.driver.fileFor(name)).toBe(path); }
  expectNoClaim(text: string): void { expect(this.all()).not.toContain(text); }
  expectNoRuntimeVerification(): void {
    const pages = this.driver.paths().filter(path => path.startsWith('docs/specification/') && path.endsWith('.md')); expect(pages.length).toBeGreaterThan(0);
    for (const path of pages) expect(this.driver.textAt(path)).toContain('Statically checked specification. Runtime behavior is not verified by this document.');
    expect(this.all()).not.toMatch(/(?:Status|Result):\s*(?:Passed|Verified)/);
  }
  rememberLocation(name: string): void { this.driver.locations.set(name, this.driver.fileFor(name)); }
  expectLocationUnchanged(name: string): void { expect(this.driver.fileFor(name)).toBe(this.driver.locations.get(name)); }
  expectDistinctExamplePages(first: string, second: string): void { expect(this.driver.fileFor(first)).not.toBe(this.driver.fileFor(second)); }
  rememberFileBytes(path: string): void { this.driver.remembered.set(path, this.driver.bytes(path)); }
  expectFileBytesUnchanged(path: string): void { expect(this.driver.bytes(path)).toEqual(this.driver.remembered.get(path)); }
  expectNotesBytes(name: string, notes: string): void { expect(Buffer.from(this.driver.notes(name))).toEqual(Buffer.from(notes)); }
  expectFileContains(path: string, text: string): void { expect(this.driver.textAt(path)).toContain(text); }
  expectReadBytesEqualFile(path: string): void { expect(this.driver.readResult.artifacts.find(item => item.file.path === path)?.file.bytes).toEqual(new Uint8Array(this.driver.bytes(path))); }
  expectReadContains(text: string): void { expect(this.driver.readResult.artifacts.some(item => Buffer.from(item.file.bytes).toString('utf8').includes(text))).toBe(true); }
  expectReadEndsWithBytes(bytes: number[]): void { expect([...this.driver.readResult.artifacts[0]!.file.bytes.slice(-bytes.length)]).toEqual(bytes); }
  expectReadFiles(paths: string[]): void { expect([...new Set(this.driver.readResult.artifacts.map(item => item.file.path))].sort()).toEqual([...paths].sort()); }
  expectIdentityUnchanged(before: string, after: string): void { expect(this.driver.id(after)).toBe(this.driver.originalIds.get(before)); }
  expectApplied(): void { expect(this.driver.written.receipt?.status).toBe('applied'); }
  expectUnchanged(): void { expect(this.driver.written.receipt?.status).toBe('unchanged'); }
  expectProblem(code: string, path?: string): void { expect(this.driver.problems.some(problem => problem.code === code && (!path || JSON.stringify(problem.at).includes(path)))).toBe(true); }
  expectOwnershipConflict(path?: string): void { this.expectProblem('output-conflict', path); }
  expectConflictAt(path: string): void { this.expectProblem('output-conflict', path); }
  expectAmbiguousDefinition(): void { this.expectProblem('ambiguous-definition'); }
  expectNoWrites(): void { expect(this.driver.files()).toBe(this.driver.before); }
  expectNoConfirmedAssociations(): void { expect(this.driver.written.artifacts).toBeUndefined(); }
  expectStaleWriteConflict(): void { expect(this.driver.written.receipt?.status).toBe('stopped'); expect(this.driver.problems.some(problem => problem.code === 'stale-project')).toBe(true); }
  expectStoppedReceiptWithCreatedFile(path: string): void {
    expect(this.driver.written.receipt?.status).toBe('stopped'); expect(this.driver.paths()).toContain(path);
    expect(this.driver.written.receipt?.outcomes.some(outcome => outcome.state === 'applied')).toBe(true);
  }
  expectDefinitionInOutput(id: string, name: string): void { expect(this.driver.searchResult.definitions.some(definition => definition.outputId === id && JSON.stringify(definition.value).includes('expec-' + Buffer.from(this.driver.id(name)).toString('hex')))).toBe(true); }
  expectNoDuplicateDefinitionAcrossOutputNamespaces(): void { expect(this.driver.problems.some(problem => problem.code === 'ambiguous-definition')).toBe(false); }
  expectOutgoingTo(name: string): void { expect(this.driver.searchResult.outgoing.uses.some(use => use.target.kind === 'specified' && use.target.id === this.driver.id(name))).toBe(true); }
  expectNoOutgoingTo(name: string): void { expect(this.driver.searchResult.outgoing.uses.some(use => use.target.kind === 'specified' && use.target.id === this.driver.id(name))).toBe(false); }
  expectIncomingFromProjectFile(path: string): void { expect(this.driver.searchResult.incoming.uses.some(use => use.target.kind === 'project' && use.target.id === path)).toBe(true); }
  expectNoIncomingFromProjectFile(path: string): void { expect(this.driver.searchResult.incoming.uses.some(use => use.target.kind === 'project' && use.target.id === path)).toBe(false); }
  expectNoIncomingFrom(name: string): void { expect(this.driver.searchResult.incoming.uses.some(use => use.target.kind === 'specified' && use.target.id === this.driver.id(name))).toBe(false); }
  expectCompleteWithinMarkdownScope(): void { expect(this.driver.searchResult.incoming.coverage.complete).toBe(true); expect(this.driver.searchResult.outgoing.coverage.complete).toBe(true); }
  expectIncompleteCoverageAt(path: string): void { expect(this.driver.searchResult.incoming.coverage.complete).toBe(false); expect(JSON.stringify(this.driver.searchResult.incoming.coverage)).toContain(path); }
}
