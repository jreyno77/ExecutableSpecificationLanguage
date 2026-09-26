export type * from './grammar/source.js';
export { AntlrSyntaxReader } from './grammar/reader.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
export function createSyntaxReader(): AntlrSyntaxReader { return new AntlrSyntaxReader(); }
export { inspect, InspectionError } from './inspection.js';
export type { Inspection, InspectionInput, InspectionKind, InspectionNode, InspectionErrorCode } from './inspection.js';
export { collect } from './collector.js';
export type { Collector } from './collector.js';
