import { bareModule } from './configuration-schema.js';
import type { ModuleModel, ModelNode } from './model.js';
import type { ProblemLocation } from './resolution/problem.js';
import { nativePath } from './source-files.js';

export function localFilename(path: string, extension = '.expec'): boolean {
  return nativePath(path) && !/[\\*?\[\]{}]/.test(path) && !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(path) && path.endsWith(extension);
}
export function validLocator(text: string): boolean {
  return /^\.{1,2}\//.test(text) ? localFilename(text) : bareModule(text);
}
export function references(model: ModuleModel): { text: string; at: ProblemLocation }[] {
  const directives: ModelNode<'use' | 'include' | 'examples-attachment'>[] =
    [...model.nodes('use'), ...model.nodes('include'), ...model.nodes('examples-attachment')];
  const result = directives.map(node => {
    const literal = model.node(node.locator, 'string-literal'); return { text: literal.value, at: literal.origin };
  });
  for (const node of model.nodes('reference')) if (node.lookup?.kind === 'module') result.push({ text: node.lookup.locator, at: node.origin });
  return result.sort((a, b) => a.at.kind === 'source' && b.at.kind === 'source' ? a.at.range.start.offset - b.at.range.start.offset : 0);
}
export function ordinal(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
