import type { CompilationInput, CompilationResult } from './model/compiler.js';
import type { SyntaxReader } from './grammar/source.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
import { SemanticValidator } from './semantics/validator.js';
export { CompilationUnimplementedError } from './unimplemented.js';

export class Compiler {
  constructor(private readonly reader: SyntaxReader = new AntlrSyntaxReader(), private readonly validator: SemanticValidator = new SemanticValidator()) {}

  compile(input: CompilationInput): CompilationResult {
    const read = this.reader.read(input.source);
    if (read.status === 'rejected') return {
      status: 'rejected',
      diagnostics: read.diagnostics.map(d => ({ code: d.category, phase: 'syntax', explanation: d.explanation, primary: { kind: 'source', range: d.primaryRange }, related: d.relatedRanges.map(range => ({ kind: 'source', range })) })),
    };
    return this.validator.validate({ document: read.document, description: read.description, dependencies: input.dependencies });
  }
}

export function createCompiler(): Compiler {
  return new Compiler();
}
