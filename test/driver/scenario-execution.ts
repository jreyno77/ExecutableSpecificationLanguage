import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import ts from 'typescript';
import { AcceptanceGenerationDriver } from './acceptance-generation.js';
import type { ShopOptions } from '../resources/scenario-execution/shop.mjs';
export type { ShopOptions };
export interface ShopEvent { id: string; event: string; title?: string; actual?: number; returned?: number; receipt?: string; listening?: boolean; contents?: [string, number][] }
export class ExecutionDriver extends AcceptanceGenerationDriver {
  events: ShopEvent[] = [];
  nativeExit = -1;
  private shopOptions: ShopOptions = {};
  private selected = false;
  private saved = new Map<string, string>();
  async initial(text: string): Promise<void> {
    await this.connect(); this.source(text); await this.nativeDependencies();
    await this.file('vitest.config.ts', `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['test/acceptance/*.test.ts'], retry: 0 } });`);
    await this.generate({ domain: 'shopping' });
    if (this.written.problems.length || !this.written.receipt) throw Error('Default generation failed: ' + JSON.stringify(this.written));
  }
  async fixture(options: ShopOptions = {}): Promise<void> {
    this.shopOptions = options;
    for (const [resource, path] of [['shop', 'src/shop.ts'], ['http-shopping', 'test/driver/http-shopping.ts'], ['http-shopping-test', 'test/dsl/http-shopping-test.ts']])
      await this.file(path!, await fs.readFile(new URL('../resources/scenario-execution/' + resource + '.mts', import.meta.url), 'utf8'));
    await this.file('shop-options.json', JSON.stringify(options)); this.selectFixture('test/dsl/http-shopping-test.ts');
  }
  selectFixture(file: string): void {
    this.reopen({ fixture: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file, declaration: [{ kind: 'variable', name: 'test' }] } } }); this.selected = true;
  }
  async generateSelected(): Promise<void> {
    if (!this.selected) throw Error('Arrange a selected native fixture');
    if (!this.diff) this.diff = this.identities.compare(this.current.baseline, this.current).value!;
    await this.update(); this.diff = this.identities.compare(this.current.baseline, this.current).value!;
  }
  async configure(options: ShopOptions): Promise<void> { Object.assign(this.shopOptions, options); await this.file('shop-options.json', JSON.stringify(this.shopOptions)); }
  async runNative(options: { order?: string[]; concurrent?: boolean; generatedOnly?: boolean } = {}): Promise<void> {
    if (this.written.problems.length || !this.written.receipt || this.written.receipt.status === 'stopped') throw Error('Acceptance connection failed: ' + JSON.stringify(this.written.problems));
    const path = 'test/acceptance/shopping.test.ts', original = await this.text(path);
    if (options.order) {
      const source = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true), tests = source.statements.filter(ts.isExpressionStatement), others = source.statements.filter(node => !ts.isExpressionStatement(node));
      const titles = new Map(tests.map(node => [((node.expression as ts.CallExpression).arguments[0] as ts.StringLiteral).text, node.getFullText(source)]));
      if (options.order.length !== tests.length || options.order.some(title => !titles.has(title))) throw Error('Execution order must select every actual scenario once');
      await this.file(path, others.map(node => node.getFullText(source)).join('') + options.order.map(title => titles.get(title)).join(''));
    }
    await this.file('vitest.config.ts', `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['test/acceptance/*.test.ts'], retry: 0, sequence: { concurrent: ${!!options.concurrent} } } });`);
    await this.file('shop-events.jsonl', '');
    try {
      try { await promisify(execFile)(process.execPath, [join(this.root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--reporter=json', '--outputFile=results.json'], { cwd: this.root, timeout: 25_000, maxBuffer: 2 ** 20, windowsHide: true }); this.nativeExit = 0; }
      catch (error) { if ((error as { code?: number }).code !== 1) throw error; this.nativeExit = 1; }
      this.nativeResult = JSON.parse(await this.text('results.json'));
      this.events = (await this.text('shop-events.jsonl')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    } finally { if (options.order) await this.file(path, original); }
  }
  async rememberPaths(paths: string[]): Promise<void> { this.saved = new Map(await Promise.all(paths.map(async path => [path, await this.text(path)] as const))); }
  async pathsUnchanged(): Promise<boolean> { for (const [path, text] of this.saved) if (await this.text(path) !== text) return false; return true; }
  async manualCaller(): Promise<void> { await this.file('test/manual.test.ts', `import { test } from './dsl/shopping-test.js'; test('handwritten caller', async ({ shopping }) => { await shopping.startWithEmptyBasket(); });`); }
  async alternate(): Promise<void> { await this.file('test/dsl/alternate-test.ts', `export { test } from './shopping-test.js';`); }
  async redirect(): Promise<void> { const path = 'test/acceptance/shopping.test.ts'; await this.file(path, (await this.text(path)).replace('../dsl/shopping-test.js', '../dsl/alternate-test.js')); }
}
