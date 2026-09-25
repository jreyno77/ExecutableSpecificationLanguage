export type * from './grammar/source.js';
export { AntlrSyntaxReader } from './grammar/reader.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
export function createSyntaxReader(): AntlrSyntaxReader { return new AntlrSyntaxReader(); }
