export class CompilationUnimplementedError extends Error {
  constructor(feature: string) {
    super(`Compiler support is not implemented yet: ${feature}`);
    this.name = 'CompilationUnimplementedError';
  }
}
