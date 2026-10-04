import { it } from 'vitest';
import { PreservationExamples } from '../dsl/typescript-preservation.js';

it('renames an imported declaration to the name of its preserved explicit local alias', async () => {
  const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
  await project.implement('StoreGame.save', '{ localStorage.setItem("store-game-save", snapshot); }');
  await project.file('launcher.ts', 'import { StoreGame as Game } from "./src/StoreGame.js"; new Game().save("Dune");');
  await project.file('index.ts', 'export { StoreGame as Game } from "./src/StoreGame.js";');

  project.change('class Game { public save\ncapability save(snapshot: Text) returns Nothing }', { rename: [['StoreGame', 'Game']] });
  await project.update();

  project.expectApplied();
  project.expectNoFile('src/StoreGame.ts');
  project.expectNativeImport('launcher.ts', { exported: 'Game', local: 'Game', from: './src/Game.js' });
  project.expectNativeExport('index.ts', { name: 'Game', from: './src/Game.js' });
  project.expectSourceIn('src/Game.ts', ['localStorage.setItem("store-game-save", snapshot);']);
  await project.checkNativeTypes();
  project.expectNativeCheckPassed();
}, 30_000);

it('refuses a bare import rename that would capture an unrelated local binding', async () => {
  const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
  await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js"; const Game = 1; new StoreGame().save();');
  await project.rememberFiles();

  project.change('class Game { public save\ncapability save() returns Nothing }', { rename: [['StoreGame', 'Game']] });
  await project.update();

  project.expectConflictAt('native-name-conflict', 'launcher.ts', 'StoreGame');
  await project.expectNoWrites();
}, 30_000);
