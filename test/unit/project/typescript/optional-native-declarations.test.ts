import { afterEach, describe, expect, it } from 'vitest';
import { Compiler, FileProjectWriter, Outputs, SpecificationIdentity, TypeScriptContext, typescriptOutput } from '../../../../src/index.js';
import { NativeContextDriver } from '../../../driver/project/typescript/typescript-context.js';

const projects: NativeContextDriver[] = [];
afterEach(async () => { for (const project of projects.splice(0)) await project.dispose(); });
async function project(): Promise<NativeContextDriver> {
  const driver = new NativeContextDriver(); projects.push(driver); await driver.connect();
  await driver.file('src/book.ts', 'import type { Book } from "catalog"; export const book: Book = { title: "Dune" };');
  return driver;
}
const optional = { peerDependencies: { renderer: '*' }, peerDependenciesMeta: { renderer: { optional: true } } };

describe('optional peer declarations retain honest native availability', { timeout: 30_000 }, () => {
  it('accepts a package-authored suppressed optional type import without installing that peer', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': '// @ts-ignore optional peer\nimport type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
    expect(captured.readOnlyFiles!.map(file => file.path)).toContain('node_modules/catalog/package.json');
    expect(captured.readOnlyFiles!.some(file => file.path.startsWith('node_modules/renderer/'))).toBe(false);
  });
  it('recognizes a suppressed declaration reexport from an optional scoped-package subpath', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'types/index.d.ts', peerDependencies: { '@shop/renderer': '*' }, peerDependenciesMeta: { '@shop/renderer': { optional: true } } }, {
      'types/index.d.ts': '// @ts-ignore optional browser types\nexport * from "@shop/renderer/context";\nexport interface Book { title: string }',
    });
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('does not infer optionality from a suppressed import alone', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', peerDependencies: { renderer: '*' } }, {
      'index.d.ts': '// @ts-ignore\nimport type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('retains the compiler error for an unsuppressed optional peer import', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': 'import type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('does not borrow optional metadata from a different package', async () => {
    const driver = await project();
    await driver.package('unrelated', { types: 'index.d.ts', ...optional }, { 'index.d.ts': 'export {};' });
    await driver.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': '// @ts-ignore\nexport type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    const captured = await new TypeScriptContext(driver.context, { imports: ['unrelated'] }).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('keeps a missing side-effect import required even with optional peer metadata', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': '// @ts-ignore optional peer\nimport "renderer";\nexport interface Book { title: string }',
    });
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('keeps an unavailable import in authored project source visible despite suppression', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, { 'index.d.ts': 'export interface Book { title: string }' });
    await driver.file('src/missing.ts', '// @ts-ignore optional peer\nimport type { Renderer } from "renderer";\nexport type Value = Renderer;');
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('does not make a module augmentation complete through optional peer metadata', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': 'declare module "renderer-adapter" {\n// @ts-ignore\nexport type { Renderer } from "renderer";\n}\nexport interface Book { title: string }',
    });
    await driver.file('src/renderer.ts', 'import type { Renderer } from "renderer-adapter"; export type RendererType = Renderer;');
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('cannot adopt an unavailable optional type as a promised Number result', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': '// @ts-ignore optional peer\nimport type { Renderer } from "renderer";\nexport type Value = Renderer;\nexport interface Book { title: string }',
    });
    await driver.file('src/price.ts', 'import type { Value } from "catalog";\nexport function price(): Value { return undefined; }');
    const checked = new Compiler().compile({ source: { sourceId: 'main.expec', text: 'function price() returns Number' }, locator: 'main', dependencies: { modules: [], packages: [] } });
    expect(checked.value).toBeDefined(); let sequence = 0;
    const identities = new SpecificationIdentity(() => 'optional-' + ++sequence), identified = identities.associate(checked.value!);
    const price = [...checked.value!.inspection.query('function')][0]!;
    const mapped = identities.withArtifacts(identified.value!, [{ specId: identified.value!.id(price.id), locator: {
      outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'src/price.ts', declaration: [{ kind: 'function', name: 'price' }] },
    } }]);
    const context = new TypeScriptContext(driver.context), outputs = new Outputs(); outputs.register(typescriptOutput);
    const opened = outputs.open('typescript', { directory: 'src', adoptExisting: true }, context, new FileProjectWriter(context), { workspaceModules: ['main'] });
    const result = await opened.value!.create(mapped.value!);
    expect(result.receipt).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('adoption-contract-mismatch');
  });
});
