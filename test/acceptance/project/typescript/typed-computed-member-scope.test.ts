import { describe, it } from 'vitest';
import { ProjectReading } from '../../../dsl/project/typescript/project-reading.js';
import { PreservationExamples } from '../../../dsl/project/typescript/typescript-preservation.js';

describe('typed computed member reference scope', () => {
  it('keeps the real content reader without uncertainty from numeric array indexes', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'model.ts': 'export type OutputTab = { content: string };',
      'reader.ts': 'import type { OutputTab } from "./model.js"; export const read = (tab: OutputTab) => tab.content;',
      'positions.ts': 'export const position = (values: number[], index: number) => values[index];',
      'tokens.ts': 'interface Token { text: string } export const token = (tokens: Token[], index: number) => tokens[index];',
    });
    project.associateSymbol('content', 'model.ts', [
      { kind: 'type', name: 'OutputTab' }, { kind: 'property', name: 'content' },
    ]);

    await project.search('content');

    project.expectDefinitions([{ file: 'model.ts', declaration: 'content: string' }]);
    project.expectIncomingAt({ file: 'reader.ts', text: 'content', within: 'tab.content', role: 'value' });
    project.expectProjectOnlyIncoming({ file: 'reader.ts', text: 'content', within: 'tab.content', role: 'value' });
    project.expectSearchCompleteWithinDeclaredScope();
  });

  it('removes an unused generated field without changing unrelated numeric helpers', async () => {
    const project = await PreservationExamples.generated('type OutputTab { label: Text\ncontent: Text }');
    await project.file('positions.ts', 'export const position = (values: number[], index: number) => values[index];');
    await project.rememberFiles(['positions.ts']);
    project.change('type OutputTab { label: Text }', { retire: ['OutputTab.content'] });

    await project.update();

    project.expectApplied();
    project.expectNoNativeDeclaration('OutputTab.content');
    project.expectNativeField('OutputTab.label', 'string', { optional: false });
    await project.expectFileBytesUnchanged('positions.ts');
  });

  it('still refuses removal while a real handwritten reader uses the field', async () => {
    const project = await PreservationExamples.generated('type OutputTab { label: Text\ncontent: Text }');
    await project.file('reader.ts', 'import type { OutputTab } from "./src/OutputTab.js"; export const read = (tab: OutputTab) => tab.content;');
    await project.file('positions.ts', 'export const position = (values: number[], index: number) => values[index];');
    project.change('type OutputTab { label: Text }', { retire: ['OutputTab.content'] });
    await project.rememberFiles();

    await project.update();

    project.expectConflictAt('remaining-native-use', 'reader.ts', 'content');
    await project.expectNoWrites();
  });
});
