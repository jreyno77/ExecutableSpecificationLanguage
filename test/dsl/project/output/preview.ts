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
    expect(result.value, 'Successful preview for ' + id).toBeDefined();
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
  expectStructuredDeclaration(path: string, name: string, field: string): void {
    const data = JSON.parse(Buffer.from(this.document('structure-list', path, 'application/json').bytes).toString('utf8'));
    expect(data).toMatchObject({ format: 'expec-structure-1', outputId: 'structure-list', declaration: {
      kind: 'record-type', name, members: [{ kind: 'field', name: field, signature: field + ': Text' }],
    } });
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
