import { afterEach, expect, it } from 'vitest';
import { KotlinProject, type ArtifactAssociation } from '../../src/index.js';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

const instances: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const driver of instances.splice(0)) await driver.dispose(); });
async function project(source: string, caller: string, associations: ArtifactAssociation[]) {
  const driver = new KotlinDeliveryDriver(); instances.push(driver); await driver.initialize(); await driver.configureNative();
  await driver.file('src/main/kotlin/store/StoreGame.kt', source);
  await driver.file('src/main/kotlin/store/Launcher.kt', caller);
  return { driver, native: new KotlinProject({ outputId: 'kotlin' }, associations), snapshot: await driver.context.readSnapshot() };
}
function association(id: string, declaration: { kind: string; name: string; parameters?: string[] }[]): ArtifactAssociation {
  return { specId: id, locator: { outputId: 'kotlin', format: 'kotlin-symbol-1', value: { file: 'src/main/kotlin/store/StoreGame.kt', declaration } } };
}
const game = { kind: 'class', name: 'StoreGame' };
function uses(result: Awaited<ReturnType<KotlinProject['search']>>) {
  expect(result.problems).toEqual([]); expect(result.incoming.coverage.complete).toBe(true);
  return result.incoming.uses.filter(use => (use.at.value as { file: string }).file.endsWith('Launcher.kt')).map(use => use.at.value);
}

it('selects the real implicit default constructor at its class declaration', async () => {
  const { native, snapshot } = await project('package store\nclass StoreGame\n', 'package store\nfun launch() = StoreGame()\n',
    [association('construction', [game, { kind: 'constructor', name: '<init>', parameters: [] }])]);
  const result = await native.search('construction', snapshot);
  expect(uses(result)).toEqual([{ file: 'src/main/kotlin/store/Launcher.kt', start: 29, end: 38, role: 'construction' }]);
  expect(result.definitions.map(at => at.value)).toEqual([{ file: 'src/main/kotlin/store/StoreGame.kt', start: 20, end: 29, role: 'definition' }]);
}, 60_000);

it('keeps conflicting native constructor declarations incomplete', async () => {
  const { native, snapshot, driver } = await project('package store\nclass StoreGame(val title: String)\n', 'package store\n',
    [association('construction', [game, { kind: 'constructor', name: '<init>', parameters: ['kotlin.String'] }])]);
  await driver.file('src/main/kotlin/store/Duplicate.kt', 'package store\nclass StoreGame(val title: String)\n');
  const result = await native.search('construction', await driver.context.readSnapshot());
  expect(result.incoming.coverage.complete).toBe(false);
  expect(result.problems.map(problem => problem.code)).toEqual(['kotlin-CLASSIFIER_REDECLARATION', 'kotlin-CLASSIFIER_REDECLARATION']);
  expect(snapshot.files.some(file => file.path.endsWith('Duplicate.kt'))).toBe(false);
}, 60_000);

it('rejects an underspecified constructor selector before native effects', () => {
  expect(() => new KotlinProject({ outputId: 'kotlin' }, [association('construction', [game, { kind: 'constructor', name: '<init>' }])])).toThrow(TypeError);
});

it('reads a primary-constructor property as a member of the actual class', async () => {
  const { native, snapshot } = await project('package store\nclass StoreGame(val title: String)\n', 'package store\n',
    [association('title', [game, { kind: 'property', name: 'title' }])]);
  const read = await native.read('title', snapshot);
  expect(read.problems).toEqual([]); expect(read.coverage.complete).toBe(true);
  expect(Buffer.from(read.artifacts[0]!.file.bytes).toString('utf8')).toBe('package store\nclass StoreGame(val title: String)\n');
}, 60_000);

it('resolves class type annotations without turning them into constructor calls', async () => {
  const { native, snapshot } = await project('package store\nclass StoreGame(val title: String)\n',
    'package store\nfun launch(): StoreGame = StoreGame("Dune")\n', [association('game', [game])]);
  expect(uses(await native.search('game', snapshot))).toEqual([
    { file: 'src/main/kotlin/store/Launcher.kt', start: 28, end: 37, role: 'type' },
    { file: 'src/main/kotlin/store/Launcher.kt', start: 40, end: 49, role: 'construction' },
  ]);
}, 60_000);

it('selects the actual secondary constructor and excludes another overload', async () => {
  const source = 'package store\nclass StoreGame(val title: String) {\n  constructor(copies: Int): this(copies.toString())\n}\n';
  const { native, snapshot } = await project(source,
    'package store\nfun byTitle() = StoreGame("Dune")\nfun byCopies() = StoreGame(2)\n',
    [association('copies', [game, { kind: 'constructor', name: '<init>', parameters: ['kotlin.Int'] }])]);
  const result = await native.search('copies', snapshot);
  expect(uses(result)).toEqual([{ file: 'src/main/kotlin/store/Launcher.kt', start: 65, end: 74, role: 'construction' }]);
  expect(result.definitions.map(at => at.value)).toEqual([{ file: 'src/main/kotlin/store/StoreGame.kt', start: 53, end: 64, role: 'definition' }]);
  const read = await native.read('copies', snapshot);
  expect(Buffer.from(read.artifacts[0]!.file.bytes).toString('utf8')).toBe(source);
}, 90_000);

it('binds omitted arguments to the declared constructor without inventing a zero-argument overload', async () => {
  const { native, snapshot } = await project('package store\nclass StoreGame(val title: String = "Dune")\n',
    'package store\nfun launch() = StoreGame()\n', [
      association('actual', [game, { kind: 'constructor', name: '<init>', parameters: ['kotlin.String'] }]),
      association('missing', [game, { kind: 'constructor', name: '<init>', parameters: [] }]),
    ]);
  expect(uses(await native.search('actual', snapshot))).toEqual([{ file: 'src/main/kotlin/store/Launcher.kt', start: 29, end: 38, role: 'construction' }]);
  const missing = await native.search('missing', snapshot);
  expect(missing.incoming.coverage.complete).toBe(false);
  expect(missing.problems.map(problem => problem.code)).toContain('native-definition-unavailable');
}, 90_000);
