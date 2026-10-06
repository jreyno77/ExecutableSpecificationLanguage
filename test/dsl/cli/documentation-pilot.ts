import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { expect, onTestFinished } from 'vitest';
import { InstalledPilotDriver } from '../../driver/cli/installed-pilot.js';

export class DocumentationPilot {
  private diagrams: { label: string; messages: string[]; svg: string }[] = [];
  private constructor(private readonly driver: InstalledPilotDriver) {}
  static async fromSource(source: string): Promise<DocumentationPilot> {
    const driver = new InstalledPilotDriver(); onTestFinished(() => driver.dispose());
    await driver.install(); await driver.file('main.expec', source);
    await driver.file('project/notes.md', 'Project notes.\n');
    await driver.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: 'project' },
      build: { entries: ['main.expec'] }, outputs: [{ id: 'markdown', options: { directory: 'reference' } },
        { id: 'uml', options: { directory: 'design', views: ['structure', 'interactions'] } }] }));
    return new DocumentationPilot(driver);
  }
  async buildOutputs(): Promise<void> {
    await this.driver.cli(['build']);
    expect(this.driver.result, JSON.stringify(this.driver.report)).toMatchObject({ code: 0 });
    expect(this.driver.report).toMatchObject({ status: 'built', problems: [] });
    await this.driver.file('read-diagram.mjs', await readFile(new URL('../../resources/pilot/read-diagram.mjs', import.meta.url), 'utf8'));
    await this.driver.run(['read-diagram.mjs']);
    expect(this.driver.result, this.driver.result.stderr).toMatchObject({ code: 0 });
    this.diagrams = JSON.parse(this.driver.result.stdout);
  }
  async expectDocumentedSignature(owner: string, name: string, inputs: string[], result: string): Promise<void> {
    expect(await this.driver.text('project/reference/' + owner + '.md')).toContain(name + '(' + inputs.join(', ') + ') returns ' + result);
  }
  expectNativeMessages(title: string, messages: string[]): void {
    const diagram = this.diagrams.filter(item => item.label.startsWith(title + '\n'));
    expect(diagram).toHaveLength(1); expect(diagram[0]!.messages).toEqual(messages);
  }
  expectNativeSvgLabels(labels: string[]): void {
    expect(this.diagrams).toHaveLength(1);
    const xml = new DOMParser({ onError: (_level, message) => { throw Error(message); } }).parseFromString(this.diagrams[0]!.svg, 'image/svg+xml');
    expect(xml.documentElement?.localName).toBe('svg');
    const text = Array.from(xml.getElementsByTagName('text')).map(node => node.textContent).join('\n');
    for (const label of labels) expect(text).toContain(label);
  }
  expectDeclaredCommunicationOnly(): void {
    expect(this.diagrams[0]!.label).toContain('Declared communication — not observed execution');
    expect((this.driver.report as { stages: { name: string }[] }).stages.some(stage => stage.name === 'execution')).toBe(false);
  }
}
