import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../../driver/package/installed-package.js';
import { PublicRecipes } from '../../dsl/package/public-recipes.js';
beforeAll(() => PackageDriver.prepare());
afterAll(() => PackageDriver.finish());

describe('an author reuses the shipped public recipes', { timeout: 180_000 }, () => {
  it('loads two entries once and generates one shared Book', async () => {
    const author = await PublicRecipes.installPackedProduct();
    await author.sources({
      'book.expec': 'type Book { title: Text }',
      'game.expec': 'use Book from "./book.expec"\nfunction save(book: Book) returns Nothing',
      'checkout.expec': 'use Book from "./book.expec"\nfunction price(book: Book) returns Number'
    });
    await author.runWorkspaceRecipe(['game.expec', 'checkout.expec']);
    author.expectFunctions(['save', 'price']);
    author.expectOneSharedTypeIdentity('Book');
    await author.expectOneGeneratedDeclaration('Book');
    await author.checkNativeConsumer('import type { Book } from "./src/Book.js";\nimport { save } from "./src/save.js";\nimport { price } from "./src/price.js";\nconst book: Book = { title: "Dune" };\nsave(book); const amount: number = price(book);');
    author.expectNativeTypecheckPassed();
  });
  it('adopts explicitly and reads a later handwritten body with its live unmodeled caller', async () => {
    const author = await PublicRecipes.installPackedProduct();
    await author.source('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await author.nativeFile('src/game.ts', 'export class StoreGame {\n  save(snapshot: string): void { console.log(snapshot); }\n}\n');
    await author.nativeFile('src/launcher.ts', 'import { StoreGame } from "./game.js";\nnew StoreGame().save("Dune");\n');
    await author.rememberNativeFiles();
    await author.runAdoptionRecipe();
    await author.expectAdoptionLeftNativeFilesUnchanged();
    await author.nativeFile('src/game.ts', 'const writeSnapshot = (snapshot: string): void => { console.log(snapshot); };\nexport class StoreGame {\n  save(snapshot: string): void { return writeSnapshot(snapshot); }\n}\n');
    await author.readAndSearchStoreGame();
    await author.expectWholeCurrentFileContains('return writeSnapshot(snapshot);');
    await author.expectUnspecifiedCallerAt('src/launcher.ts', 'save');
    await author.expectOnlyHostOwnedPublicBaseline();
  });
});
