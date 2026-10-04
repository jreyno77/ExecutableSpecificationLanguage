import { appendFileSync, readFileSync } from 'node:fs';
import { Compiler, type Compilation } from 'executable-specification-language';

export class CompilerDriver {
  private result?: Compilation;
  private source = '';
  async readSource(source: string): Promise<void> {
    this.source = source;
    this.result = new Compiler().compile({ source: { sourceId: 'consumer.expec', text: source },
      locator: 'consumer', dependencies: { modules: [], packages: [] } });
    appendFileSync('compiler-observations.jsonl', JSON.stringify({
      packageUrl: import.meta.resolve('executable-specification-language'), source,
      accepted: !!this.result.value, syntax: this.result.syntax, deferred: this.result.deferred,
      diagnostics: this.diagnostics(),
    }) + '\n');
  }
  async problemFound(code: string, text: string, line: number, column: number): Promise<boolean> {
    if (JSON.parse(readFileSync('compiler-options.json', 'utf8')).suppressProblems) return false;
    return this.diagnostics().some(item => item.code === code && item.text === text && item.line === line && item.column === column);
  }
  async acceptedWithoutProblems(): Promise<boolean> {
    return !!this.result?.value && this.result.syntax.length === 0 && this.result.problems.length === 0 && this.result.deferred.length === 0;
  }
  private diagnostics(): { code: string; text: string; line: number; column: number }[] {
    return this.result?.problems.flatMap(problem => problem.at.kind === 'source' ? [{ code: problem.code,
      text: [...this.source].slice(problem.at.range.start.offset, problem.at.range.end.offset).join(''),
      line: problem.at.range.start.line, column: problem.at.range.start.column }] : []) ?? [];
  }
}
