export type * from './grammar/source.js';
export { AntlrSyntaxReader } from './grammar/reader.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
export function createSyntaxReader(): AntlrSyntaxReader { return new AntlrSyntaxReader(); }

export { visitSource, type SourceVisitors } from './inspection/callback.js';
export { inspectSource, type SourceInspection } from './inspection/query.js';
export { SourceInspectionError, type SourceLookup, type SourceNodeOf, type SourceKind } from './inspection/source-access.js';
