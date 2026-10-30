import { expect } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';
import { posix } from 'node:path';
import { MarkdownExamples } from './markdown.js';
import { MarkdownWikiDriver } from '../../../driver/project/output/markdown-wiki.js';

const nodes = (text: string): RootContent[] => {
  const result: RootContent[] = [];
  const visit = (node: RootContent) => { result.push(node); if ('children' in node) node.children.forEach(child => visit(child as RootContent)); };
  fromMarkdown(text).children.forEach(visit); return result;
};
const plain = (text: string): string => nodes(text).filter(node => node.type === 'text' || node.type === 'inlineCode').map(node => node.value).join('');
const links = (text: string) => nodes(text).filter(node => node.type === 'link');
const sourcePath = (source: string) => 'docs/specification/pages/' + (source.endsWith('.expec') ? source.slice(0, -6) : source) + '.md';
const nativeAnchor = (id: string) => 'expec-' + Buffer.from(id).toString('hex');

/** Reads actual Markdown, native links, returned plans and exact project bytes. */
export class MarkdownWikiExamples extends MarkdownExamples {
  declare readonly driver: MarkdownWikiDriver;
  private rememberedPreview: readonly { path: string; bytes: Uint8Array }[] = [];
  private rememberedProject = '';
  private rememberedNotes?: { source: string; bytes: Uint8Array };
  private rememberedSection?: { name: string; bytes: Uint8Array };
  private readonly sourceIdentities = new Map<string, string>();
  constructor() { super(new MarkdownWikiDriver()); }
  useNativeFileManifest(): void {
    this.driver.manifestLocation = process.platform === 'win32' ? 'C:/workspace/expec.json' : '/c:/workspace/expec.json';
  }
  rememberSourceIdentity(name: string): void { this.sourceIdentities.set(name, this.driver.id(name)); }
  expectRetainedSourceIdentity(name: string, source: string): void {
    const id = this.sourceIdentities.get(name); expect(id).toBeDefined(); expect(this.driver.id(name)).toBe(id);
    expect(this.driver.current.baseline.elements.find(record => record.id === id)?.origin).toMatchObject({
      kind: 'source', module: source, node: { sourceId: source }, range: { sourceId: source },
    });
  }
  expectSourcePageIdentity(source: string, path: string): void {
    const state = JSON.parse(this.driver.textAt(this.driver.statePath()));
    expect(state.pages).toContainEqual(expect.objectContaining({ kind: 'source', key: source, path }));
  }
  private page(source: string) { return this.driver.textAt(sourcePath(source)); }
  private wikiSection(name: string) { return this.driver.section(name); }
  private navigation(source: string) {
    const text = this.page(source), start = text.indexOf('<!-- expec-navigation -->'), end = text.indexOf('<!-- expec-navigation-end -->', start);
    expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start); return text.slice(start, end);
  }
  expectPageSections(source: string, names: string[]) {
    const headings = nodes(this.page(source)).filter(node => node.type === 'heading' && node.depth === 2).map(node => plain(this.page(source).slice(node.position!.start.offset, node.position!.end.offset)));
    expect(headings.filter(name => name !== 'Contents' && name !== 'Your notes')).toEqual(names);
  }
  private expectGlossaryText(text: string, names: string[], retainedIdentities = true) {
    const headings = nodes(text).filter(node => node.type === 'heading');
    const glossaries = headings.filter(node => node.depth === 2 && plain(text.slice(node.position!.start.offset, node.position!.end.offset)) === 'Glossary');
    expect(glossaries).toHaveLength(names.length ? 1 : 0);
    if (!names.length) return;
    const start = glossaries[0]!.position!.end.offset!;
    const end = text.indexOf('<!-- expec-page-end:', start);
    expect(end).toBeGreaterThan(start);
    const entries = headings.filter(node => node.depth === 3 && node.position!.start.offset! > start && node.position!.start.offset! < end);
    expect(entries.map(node => plain(text.slice(node.position!.start.offset, node.position!.end.offset)))).toEqual(names);
    expect(headings.filter(node => node.depth === 2 && node.position!.start.offset! > start && node.position!.start.offset! < end)).toEqual([]);
    const sections = [...text.matchAll(/<!-- expec-section:([a-f0-9]+) -->/g)].map(match => ({
      start: match.index!, end: match.index! + match[0].length, metadata: JSON.parse(Buffer.from(match[1]!, 'hex').toString()),
    }));
    for (const [index, name] of names.entries()) {
      const heading = entries[index]!, section = sections.filter(section => section.end < heading.position!.start.offset!).at(-1);
      expect(section, name).toBeDefined(); expect(section!.metadata.outputId).toBe('markdown');
      if (retainedIdentities) expect(section!.metadata.specId, name).toBe(this.driver.id(name));
      expect(sections.filter(candidate => candidate.metadata.specId === section!.metadata.specId), name).toHaveLength(1);
      expect(section!.start, name).toBeGreaterThan(start); expect(section!.start, name).toBeLessThan(end);
      const anchor = '<a id="' + nativeAnchor(section!.metadata.specId) + '"></a>';
      expect(text.split(anchor).length - 1, name).toBe(1);
      expect(text.indexOf(anchor), name).toBeGreaterThan(section!.start);
      expect(text.indexOf(anchor), name).toBeLessThan(end);
    }
  }
  expectGlossary(source: string, names: string[]) { this.expectGlossaryText(this.page(source), names); }
  expectPreviewGlossary(source: string, names: string[]) {
    const document = this.driver.previewDocuments.find(document => document.path === sourcePath(source));
    expect(document).toBeDefined(); this.expectGlossaryText(Buffer.from(document!.bytes).toString(), names, false);
  }
  expectExamplesGroupedWith(subject: string, titles: string[], placement: { before: string }) {
    const path = this.driver.fileFor(subject), text = this.driver.textAt(path);
    const start = text.indexOf(this.driver.marker(subject)), next = text.indexOf(this.driver.marker(placement.before));
    expect(start).toBeGreaterThanOrEqual(0); expect(this.driver.fileFor(placement.before)).toBe(path); expect(next).toBeGreaterThan(start);
    const headings = nodes(text).filter(node => node.type === 'heading');
    const heading = headings.find(node => node.position!.start.offset! > start)!;
    expect(heading).toBeDefined();
    const boundary = headings.find(node => node.position!.start.offset! > heading.position!.start.offset! && node.depth <= heading.depth)?.position!.start.offset ?? text.length;
    for (const title of titles) {
      expect(this.driver.fileFor(title)).toBe(path);
      const offset = text.indexOf(this.driver.marker(title));
      expect(offset, title).toBeGreaterThan(heading.position!.end.offset!);
      expect(offset, title).toBeLessThan(next); expect(offset, title).toBeLessThan(boundary);
      this.expectDeclarationCount(title, 1);
    }
  }
  expectLinkedExamples(subject: string, source: string, titles: string[]) {
    const subjectPath = this.driver.fileFor(subject), targetPath = sourcePath(source), target = this.driver.textAt(targetPath);
    const resolve = (from: string, url: string) => {
      const [path, fragment] = url.split('#');
      return { path: posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(path || posix.basename(from)))), fragment: fragment && decodeURIComponent(fragment) };
    };
    const candidates = links(this.wikiSection(subject)).map(link => resolve(subjectPath, link.url)).filter(link => link.path === targetPath && link.fragment);
    expect(candidates.length, 'Actual Examples link from ' + subject).toBeGreaterThan(0);
    const regions = candidates.map(link => {
      expect(target).toContain('<a id="' + link.fragment + '"></a>');
      const id = Buffer.from(link.fragment!.slice('expec-'.length), 'hex').toString();
      const marker = [...target.matchAll(/<!-- expec-section:([a-f0-9]+) -->/g)].find(match => {
        const metadata = JSON.parse(Buffer.from(match[1]!, 'hex').toString()); return metadata.outputId === 'markdown' && metadata.specId === id;
      });
      expect(marker).toBeDefined();
      const end = target.indexOf('<!-- expec-end:' + Buffer.from(id).toString('hex') + ' -->', marker!.index);
      expect(end).toBeGreaterThan(marker!.index!); return target.slice(marker!.index, end);
    });
    for (const title of titles) {
      expect(this.driver.fileFor(title)).toBe(targetPath);
      expect(regions.some(region => region.includes(this.driver.marker(title))), title).toBe(true);
      this.expectDeclarationCount(title, 1);
    }
    expect(regions.some(region => links(region).map(link => resolve(targetPath, link.url)).some(link => link.path === subjectPath && link.fragment === nativeAnchor(this.driver.id(subject))))).toBe(true);
  }
  expectGlossaryNavigation(source: string, firstType: string) {
    const text = this.page(source), navigation = this.navigation(source);
    const heading = nodes(text).find(node => node.type === 'heading' && node.depth === 2 && plain(text.slice(node.position!.start.offset, node.position!.end.offset)) === 'Glossary');
    expect(heading).toBeDefined();
    const start = heading!.position!.end.offset!, end = text.indexOf('<!-- expec-page-end:', start);
    expect(end).toBeGreaterThan(start);
    const glossary = text.slice(start, end), anchors = [...glossary.matchAll(/<a id="([^"]+)">/g)].map(match => match[1]!);
    const firstAnchor = nativeAnchor(this.driver.id(firstType)); expect(anchors[0]).toBe(firstAnchor);
    const actual = links(navigation).map(link => ({ label: plain(navigation.slice(link.position!.start.offset, link.position!.end.offset)), url: link.url }));
    expect(actual.filter(link => link.label === 'Glossary')).toEqual([{ label: 'Glossary', url: '#' + firstAnchor }]);
    expect(actual.filter(link => link.url.startsWith('#') && anchors.includes(decodeURIComponent(link.url.slice(1)))))
      .toEqual([{ label: 'Glossary', url: '#' + firstAnchor }]);
    for (const entry of nodes(glossary).filter(node => node.type === 'heading' && node.depth === 3))
      expect(actual.map(link => link.label)).not.toContain(plain(glossary.slice(entry.position!.start.offset, entry.position!.end.offset)));
  }
  expectTableOfContents(source: string, names: string[]) {
    expect(links(this.navigation(source)).filter(link => link.url.startsWith('#')).map(link => plain(this.navigation(source).slice(link.position!.start.offset, link.position!.end.offset)))).toEqual(names);
  }
  expectPromiseBullets(name: string, expected: string[]) {
    const actual = nodes(this.wikiSection(name)).filter(node => node.type === 'listItem').map(node => plain(this.wikiSection(name).slice(node.position!.start.offset, node.position!.end.offset)));
    for (const promise of expected) expect(actual.filter(text => text === promise)).toHaveLength(1);
  }
  expectInputEntries(name: string, expected: { name: string; type: string; default?: string }[]) {
    const owner = this.wikiSection(name), offsets = expected.map(parameter => owner.indexOf(this.driver.marker(name + '.' + parameter.name, 'markdown', 'fragment')));
    expect((owner.match(/<!-- expec-fragment:/g) ?? []).length).toBe(expected.length);
    expect(offsets.every(offset => offset >= 0)).toBe(true); expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    for (const parameter of expected) {
      const fragment = plain(this.wikiSection(name + '.' + parameter.name));
      expect(fragment).toContain(parameter.name); expect(fragment).toContain(parameter.type);
      if (parameter.default !== undefined) expect(fragment).toContain(parameter.default);
      else expect(fragment).not.toContain('Default:');
    }
  }
  expectReturn(name: string, type: string) { expect(plain(this.wikiSection(name))).toContain('Returns: ' + type); }
  expectNoRepeatedWarningsOrInputs(name: string) {
    const text = this.wikiSection(name);
    expect(text).not.toContain('Authored intent —'); expect(text).not.toContain('Declared contract —');
    expect(text).not.toContain('Source: file:'); expect(text).not.toMatch(/^Input:/m);
    expect((plain(text).match(/Inputs/g) ?? []).length).toBeLessThanOrEqual(1);
  }
  expectHomeLinks(expected: string[]) { expect(links(this.driver.textAt('docs/specification/Home.md')).map(link => link.url)).toEqual(expected); }
  expectBackToHome(source: string) { expect(links(this.navigation(source)).some(link => link.url === posix.relative(posix.dirname(sourcePath(source)), 'docs/specification/Home.md'))).toBe(true); }
  expectDeclarationLink(owner: string, target: string, address: { relativePath: string; anchorOf: string }) {
    expect(links(this.wikiSection(owner)).map(link => link.url)).toContain(address.relativePath + '#' + nativeAnchor(this.driver.id(address.anchorOf)));
  }
  expectInputFragmentOwnsTypeLink(name: string, target: string) { expect(links(this.wikiSection(name)).map(link => link.url)).toContain('#' + nativeAnchor(this.driver.id(target))); }
  expectIncomingFrom(name: string) { expect(this.driver.searchResult.incoming.uses.some(use => use.target.kind === 'specified' && use.target.id === this.driver.id(name))).toBe(true); }
  expectNavigationIsNotSemanticUse(path: string) { expect(this.driver.searchResult.incoming.uses.some(use => JSON.stringify(use.at.value).includes(path))).toBe(false); }
  expectNoInventedSemanticSubjects() {
    expect(this.driver.current.baseline.elements).toEqual([]);
    const state = JSON.parse(this.driver.textAt(this.driver.statePath()));
    expect((state.pages ?? state.documents).flatMap((page: { subjects: unknown[] }) => page.subjects)).toEqual([]);
  }
  expectAllGeneratedLinksResolve() {
    const paths = this.driver.paths();
    for (const path of paths.filter(path => path.startsWith('docs/specification/') && path.endsWith('.md'))) {
      for (const link of links(this.driver.textAt(path))) {
        if (/^[a-z][\w+.-]*:/i.test(link.url)) continue;
        const [address, fragment] = link.url.split('#'), target = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(address || posix.basename(path))));
        expect(paths, link.url).toContain(target);
        if (fragment) expect(this.driver.textAt(target)).toContain('<a id="' + decodeURIComponent(fragment) + '"></a>');
      }
    }
  }
  rememberAllProjectBytes() { this.rememberedProject = this.driver.files(); }
  expectAllProjectBytesUnchanged() { expect(this.driver.files()).toBe(this.rememberedProject); }
  async planFrom(entry: string) { this.driver.entry = entry; await this.planUpdate(); }
  expectProblemAt(code: string, path: string) { expect(this.driver.problems.some(problem => problem.code === code && JSON.stringify(problem.at).includes(path))).toBe(true); }
  expectNoPlanAndNoWrites() { expect(this.driver.plan.value).toBeUndefined(); expect(this.driver.files()).toBe(this.driver.before); }
  async deleteSubject(name: string) { await this.delete(name); }
  async insertFrom(entry: string) { this.driver.entry = entry; await this.insert(); }
  async updateFrom(entry: string, decisions?: { retire: string[] }) { this.driver.entry = entry; for (const name of decisions?.retire ?? []) this.retireIdentity(name); await this.update(); }
  async planUpdateFrom(entry: string, decisions?: { retire: string[] }) { this.driver.entry = entry; for (const name of decisions?.retire ?? []) this.retireIdentity(name); await this.planUpdate(); }
  private notes(source: string) {
    const text = this.page(source), marker = /<!-- expec-page-end:[a-f0-9]+ -->\n\n/.exec(text);
    if (!marker || marker.index === undefined) throw Error('Actual source page has no completed page boundary.');
    return { text, end: marker.index + marker[0].length };
  }
  async replacePageNotes(source: string, text: string) { const page = this.notes(source); await this.driver.write(sourcePath(source), page.text.slice(0, page.end) + text); }
  rememberPageNotesBytes(source: string) { const page = this.notes(source); this.rememberedNotes = { source, bytes: Buffer.from(page.text.slice(page.end)) }; }
  expectRememberedPageNotesBytes(source: string) { const page = this.notes(source); expect(Buffer.from(page.text.slice(page.end))).toEqual(this.rememberedNotes?.bytes); }
  rememberSectionBytes(name: string) { this.rememberedSection = { name, bytes: Buffer.from(this.wikiSection(name)) }; }
  expectRememberedSectionBytes(name: string) { expect(Buffer.from(this.wikiSection(name))).toEqual(this.rememberedSection?.bytes); }
  async writePageNotesLink(source: string, target: string) { await this.driver.append(sourcePath(source), '\n[Read](' + '#' + nativeAnchor(this.driver.id(target)) + ')\n'); }
  async previewFrom(entry: string) { this.driver.entry = entry; await this.driver.preview(); }
  async identifyFrom(entry: string) { this.driver.entry = entry; this.driver.identify(); }
  async previewIdentifiedRegistration() { await this.driver.preview(true); }
  rememberPreviewDocuments() { this.rememberedPreview = this.driver.previewDocuments.map(document => ({ path: document.path, bytes: Uint8Array.from(document.bytes) })); }
  async generateIdentified() { await this.generate(); }
  expectGeneratedRegionsEqualRememberedPreview() {
    for (const document of this.rememberedPreview) expect(this.driver.bytes(document.path).subarray(0, document.bytes.length)).toEqual(Buffer.from(document.bytes));
  }
  expectPreviewPages(expected: string[]) { expect(this.driver.previewDocuments.map(document => document.path).sort()).toEqual([...expected].sort()); }
  expectPreviewSections(source: string, expected: string[]) {
    const found = this.driver.previewDocuments.find(document => document.path === sourcePath(source)); expect(found).toBeDefined();
    const text = Buffer.from(found!.bytes).toString();
    expect(nodes(text).filter(node => node.type === 'heading' && node.depth === 2).map(node => plain(text.slice(node.position!.start.offset, node.position!.end.offset))).filter(name => name !== 'Contents')).toEqual(expected);
  }
  expectAllPreviewLinksResolve() {
    const docs = new Map(this.driver.previewDocuments.map(document => [document.path, Buffer.from(document.bytes).toString()]));
    for (const [path, text] of docs) for (const link of links(text)) {
      if (/^[a-z][\w+.-]*:/i.test(link.url)) continue;
      const [address, fragment] = link.url.split('#'), target = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(address || posix.basename(path))));
      expect(docs.has(target), link.url).toBe(true); if (fragment) expect(docs.get(target)).toContain('<a id="' + decodeURIComponent(fragment) + '"></a>');
    }
  }
}
