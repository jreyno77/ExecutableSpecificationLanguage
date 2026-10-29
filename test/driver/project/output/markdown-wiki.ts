import { FileProjectWriter, markdownOutput, type Output, type OutputPreviewDocument } from '../../../../src/index.js';
import { MarkdownDriver } from './markdown.js';

/** Uses actual connected writers and the existing projection/preview public seams. */
export class MarkdownWikiDriver extends MarkdownDriver {
  previewDocuments: readonly OutputPreviewDocument[] = [];
  readonly settings: Record<string, unknown> = {};
  membership() { return { workspaceModules: [...this.sources.size ? this.sources.keys() : [this.entry]] }; }
  override async output(id = 'markdown'): Promise<Output> {
    if (id !== 'markdown') return super.output(id);
    const context = await this.connect(), result = this.outputs.open('markdown', { directory: 'docs/specification', ...this.settings }, context,
      new FileProjectWriter(context), this.membership());
    if (!result.value) throw Error(JSON.stringify(result));
    return result.value;
  }
  async preview(sameIdentity = false): Promise<void> {
    this.identify();
    if (sameIdentity) {
      const result = await markdownOutput.preview!(this.current, { directory: 'docs/specification', ...this.settings }, this.membership());
      if (!result.value) throw Error(JSON.stringify(result)); this.previewDocuments = result.value;
    } else {
      const result = await this.outputs.preview('markdown', { directory: 'docs/specification', ...this.settings }, this.current.specification, this.membership());
      if (!result.value) throw Error(JSON.stringify(result)); this.previewDocuments = result.value.documents;
    }
  }
}
