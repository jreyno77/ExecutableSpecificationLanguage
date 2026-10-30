import { afterEach, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import type { Check, OutputPreview, OutputPreviewDocument } from '../../../../src/index.js';
import { PreviewDriver } from '../../../driver/project/output/preview.js';

const active = new Set<PreviewExample>();
afterEach(async () => { for (const example of active) await example.driver.dispose(); active.clear(); });

/** Authored source, draft projection actions and observations over authoritative returned content. */
export class PreviewExample {
  private constructor(readonly driver: PreviewDriver) { active.add(this); }
  static specify(text: string, sourceId?: string): PreviewExample { return new PreviewExample(new PreviewDriver(text, sourceId)); }
  static specifyAtSourcePath(path: string, text: string): PreviewExample {
    const example = this.specify(text); example.driver.sourcePath(path, text); return example;
  }
  static async withExistingFiles(files: Readonly<Record<string, string>>): Promise<PreviewExample> {
    const example = this.specifyAtSourcePath('src/book.expec', files['src/book.expec']!); await example.driver.arrangeFiles(files); return example;
  }
  revise(text: string): void { this.driver.revise(text); }
  async show(id: string, options: Readonly<Record<string, unknown>>): Promise<void> { await this.driver.show(id, options); }
  remember(id: string): void { this.driver.remember(id); }
  useManifestAtWorkspaceRoot(): void { this.driver.useManifest(); }
  private result(id: string): Check<OutputPreview> {
    const result = this.driver.results.get(id); expect(result, 'Actual preview for ' + id).toBeDefined(); return result!;
  }
  private document(id: string, path: string, mediaType?: string): OutputPreviewDocument {
    const result = this.result(id);
    expect(result.value, 'Successful preview for ' + id + ': ' + JSON.stringify(result.problems)).toBeDefined();
    expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]);
    expect(result.value!.outputId).toBe(id);
    const document = result.value!.documents.find(document => document.path === path);
    expect(document, 'Actual draft document ' + path).toBeDefined();
    expect(document!.bytes).toBeInstanceOf(Uint8Array);
    if (mediaType) expect(document!.mediaType).toBe(mediaType);
    return document!;
  }
  expectDocument(id: string, path: string, mediaType: string, content: string): void {
    expect(Buffer.from(this.document(id, path, mediaType).bytes).toString('utf8')).toContain(content);
  }
  expectDocumentExcludes(id: string, path: string, content: string): void {
    expect(Buffer.from(this.document(id, path).bytes).toString('utf8')).not.toContain(content);
  }
  expectNoDocument(id: string, path: string): void {
    const result = this.result(id); expect(result.value).toBeDefined(); expect(result.value!.outputId).toBe(id);
    expect(result.value!.documents.some(document => document.path === path)).toBe(false);
  }
  expectRememberedDocument(path: string, content: string): void {
    const remembered = this.driver.remembered; expect(remembered?.value).toBeDefined();
    expect(remembered!.value!.outputId).toBe('typescript');
    const document = remembered!.value!.documents.find(document => document.path === path);
    expect(document).toBeDefined(); expect(document!.mediaType).toBe('text/typescript');
    expect(Buffer.from(document!.bytes).toString('utf8')).toContain(content);
  }
  expectSvgLabel(path: string, label: string): void {
    const text = Buffer.from(this.document('uml', path, 'image/svg+xml').bytes).toString('utf8');
    const document = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(text, 'image/svg+xml');
    expect(document.documentElement?.localName).toBe('svg');
    const labels = ['text', 'tspan'].flatMap(name => Array.from(document.getElementsByTagNameNS('http://www.w3.org/2000/svg', name), node => node.textContent?.trim()));
    expect(labels).toContain(label);
  }
  expectDiagramPromises(path: string, expected: { label: string; promises: string[] }[]): void {
    const document = this.document('uml', path, 'image/svg+xml');
    expect(document).toHaveProperty('diagram');
    const diagram = document.diagram!;
    expect(diagram.promises.map(item => ({ label: item.label, promises: item.promises }))).toEqual(expected);
  }
  expectPromiseAnchorsOnActualRows(path: string, expected: string[]): void {
    const document = this.document('uml', path, 'image/svg+xml'), diagram = document.diagram;
    expect(diagram).toBeDefined();
    const xml = new DOMParser().parseFromString(Buffer.from(document.bytes).toString(), 'image/svg+xml');
    const viewport = Array.from(xml.getElementsByTagName('svg')).find(node => node.getAttribute('class')?.split(/\s+/).includes('d2-svg'));
    expect(viewport).toBeDefined();
    const [left, top, width, height] = viewport!.getAttribute('viewBox')!.split(/\s+/).map(Number);
    expect([diagram!.width, diagram!.height]).toEqual([width, height]);
    const nativeText = Buffer.from(this.document('uml', path.replace(/\.svg$/, '.d2')).bytes).toString();
    const metadata = nativeText.split('\n').filter(line => line.trim().startsWith('# expec-uml: '))
      .map(line => JSON.parse(Buffer.from(line.trim().slice(13), 'base64url').toString()));
    for (const label of expected) {
      const anchor = diagram!.promises.find(item => item.label === label); expect(anchor, label).toBeDefined();
      const split = label.lastIndexOf('.'), owner = split < 0 ? label : label.slice(0, split), operation = split < 0 ? label : label.slice(split + 1);
      const group = Array.from(viewport!.getElementsByTagName('g')).find(group =>
        /^s_[a-f0-9]+$/.test(Buffer.from(group.getAttribute('class') ?? '', 'base64').toString())
        && Array.from(group.getElementsByTagName('tspan')).some(text => text.textContent === owner));
      expect(group, 'actual native owner for ' + label).toBeDefined();
      const texts = Array.from(group!.getElementsByTagName('text'));
      const caption = texts.find(text => text.textContent?.startsWith(operation + '(')); expect(caption).toBeDefined();
      const baseline = Number(caption!.getAttribute('y')) - top!;
      expect(anchor!.y).toBeLessThan(baseline); expect(anchor!.y + anchor!.height).toBeGreaterThan(baseline);
      for (const other of texts.filter(text => text !== caption && text.textContent?.includes('('))) {
        const otherBaseline = Number(other.getAttribute('y')) - top!;
        expect(otherBaseline > anchor!.y && otherBaseline < anchor!.y + anchor!.height).toBe(false);
      }
      const boundary = Array.from(group!.getElementsByTagName('rect')).find(rect => !rect.getAttribute('class')?.includes('class_header'))!;
      expect(anchor!.x).toBeGreaterThanOrEqual(Number(boundary.getAttribute('x')) - left!);
      expect(anchor!.x + anchor!.width).toBeLessThanOrEqual(Number(boundary.getAttribute('x')) - left! + Number(boundary.getAttribute('width')));
      expect(anchor!.y + anchor!.height).toBeLessThanOrEqual(Number(boundary.getAttribute('y')) - top! + Number(boundary.getAttribute('height')));
      const key = Buffer.from(group!.getAttribute('class')!, 'base64').toString();
      expect(metadata.find(item => item.owner === key && item.name === operation)?.member).toBe(anchor!.id);
    }
    expect(new Set(diagram!.promises.map(item => item.id)).size).toBe(diagram!.promises.length);
  }
  expectNoVisiblePromises(path: string, promises: string[]): void {
    const svg = new DOMParser().parseFromString(Buffer.from(this.document('uml', path).bytes).toString(), 'image/svg+xml');
    const visible = Array.from(svg.getElementsByTagName('text')).map(node => node.textContent ?? '').join('\n');
    for (const promise of promises) expect(visible).not.toContain(promise);
  }
  expectStaticSvgPromises(path: string, expected: string[]): void {
    const svg = new DOMParser().parseFromString(Buffer.from(this.document('uml', path).bytes).toString(), 'image/svg+xml');
    const fallback = ['title', 'desc'].flatMap(tag => Array.from(svg.getElementsByTagName(tag), node => node.textContent ?? '')).join('\n');
    for (const text of expected) expect(fallback).toContain(text);
  }
  expectNoActiveSvgMarkup(path: string): void {
    const svg = new DOMParser().parseFromString(Buffer.from(this.document('uml', path).bytes).toString(), 'image/svg+xml');
    for (const tag of ['script', 'foreignObject', 'iframe', 'image']) expect(svg.getElementsByTagName(tag).length).toBe(0);
    for (const node of Array.from(svg.getElementsByTagName('*'))) for (const attribute of Array.from(node.attributes)) {
      expect(attribute.name.startsWith('on')).toBe(false);
      if (['href', 'xlink:href', 'src'].includes(attribute.name)) expect(attribute.value).toMatch(/^(?:#|data:)/);
    }
  }
  expectStructuredDeclaration(path: string, name: string, field: string): void {
    const data = JSON.parse(Buffer.from(this.document('structure-list', path, 'application/json').bytes).toString('utf8'));
    expect(data).toMatchObject({ format: 'expec-structure-1', outputId: 'structure-list', declaration: {
      kind: 'record-type', name, members: [{ kind: 'field', name: field, signature: field + ': Text' }],
    } });
  }
  expectDeclaredOptionalParameter(owner: string, operation: string, parameter: string): void {
    const inspection = this.driver.specification.inspection;
    const capability = [...inspection.query('capability')].find(node => {
      const parent = inspection.parent(node.id);
      return node.name === operation && parent && 'name' in parent && parent.name === owner;
    });
    expect(capability?.parameters.find(slot => slot.name === parameter)?.declaredType.kind).toBe('optional-type');
  }
  expectNoFindings(id: string): void {
    const result = this.result(id); expect(result.value).toBeDefined(); expect(result.value!.outputId).toBe(id);
    expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]);
  }
  expectRefused(id: string): void {
    const result = this.result(id); expect(result.value).toBeUndefined(); expect(result.problems.length + result.deferred.length).toBeGreaterThan(0);
  }
  expectProblemCode(id: string, code: string): void {
    this.expectRefused(id); expect(this.result(id).problems.map(problem => problem.code)).toContain(code);
  }
  expectProblem(id: string, code: string, message: string): void {
    this.expectRefused(id); expect(this.result(id).problems).toEqual(expect.arrayContaining([expect.objectContaining({ code, message })]));
  }
  expectSpecificationUnchanged(): void {
    expect(this.driver.specificationState()).toBe(this.driver.originalSpecificationState);
    expect(this.driver.specificationsUsed).toHaveLength(3);
    for (const specification of this.driver.specificationsUsed) expect(specification).toBe(this.driver.specification);
  }
  async expectExistingFilesUnchanged(): Promise<void> { expect(await this.driver.tree()).toEqual(this.driver.originalFiles); }
  expectNoTargetAccess(): void { expect(this.driver.observation.accesses).toEqual([]); expect(this.driver.forbiddenEntries).toEqual([]); }
}
