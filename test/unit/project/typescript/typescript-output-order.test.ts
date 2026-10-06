import { expect, it } from 'vitest';
import { TypeScriptContext } from '../../../../src/index.js';
import { PreservationExamples } from '../../../dsl/project/typescript/typescript-preservation.js';

it('adds a captured native dependency before changing its handwritten importer', async () => {
  const project = await PreservationExamples.mappedStoreGame('save(snapshot: string): void { localStorage.setItem("save", snapshot); }');
  await project.file('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', strict: true, types: [] }, include: ['**/*.ts'] }));
  project.driver.context = new TypeScriptContext(project.driver.context, { configFile: 'tsconfig.json' });
  await project.create({ directory: 'src', configFile: 'tsconfig.json', adoptExisting: true });
  project.expectApplied();
  await project.rememberImplementation(['StoreGame.save']);

  project.change(`class StoreGame {
    depends on SupabaseStorage
    public save
    capability save(snapshot: Text) returns Nothing
  }
  class SupabaseStorage {}`);
  await project.update();

  project.expectApplied();
  await project.expectImplementationBytesKept();
  expect(project.driver.files.get('src/SupabaseStorage.ts')).toContain('export class SupabaseStorage');
  expect(project.driver.files.get('game.ts')).toContain('from "./src/SupabaseStorage.js"');
  expect((await project.driver.context.readSnapshot()).complete).toBe(true);
}, 30_000);
