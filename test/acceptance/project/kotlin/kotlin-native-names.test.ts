import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../../../dsl/project/kotlin/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('refuses two mapped parameters claiming one native parameter', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(\n  first: Text,\n  second: Text\n) returns Nothing');
  project.options({ names: [{ declaration: ['save', 'first'], name: 'value' }, { declaration: ['save', 'second'], name: 'value' }] });
  await project.rememberProjectFiles(); await project.planContracts();
  project.expectProblemAt('native-name-conflict', 3, 3); project.expectNoWritePlan();
  await project.expectProjectFilesUnchanged();
}, 60_000);

it('refuses mapped methods with the same native parameters despite different returns', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame {\n capability save(title: Text) returns Text\n capability load(title: Text) returns Number\n}');
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'value' }, { declaration: ['StoreGame', 'load'], name: 'value' }] });
  await project.rememberProjectFiles(); await project.planContracts();
  project.expectProblemAt('native-name-conflict', 3, 2); project.expectNoWritePlan();
  await project.expectProjectFilesUnchanged();
}, 60_000);

it('refuses two mapped record fields claiming one property', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Book {\n title: Text\n copies: Number\n}');
  project.options({ names: [{ declaration: ['Book', 'title'], name: 'value' }, { declaration: ['Book', 'copies'], name: 'value' }] });
  await project.rememberProjectFiles(); await project.planContracts();
  project.expectProblemAt('native-name-conflict', 3, 2); project.expectNoWritePlan();
  await project.expectProjectFilesUnchanged();
}, 60_000);

it('refuses two mapped type parameters in the same record', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Pair<First, Second> { first: First\nsecond: Second }');
  project.options({ names: [{ declaration: ['Pair', 'First'], name: 'Value' }, { declaration: ['Pair', 'Second'], name: 'Value' }] });
  await project.rememberProjectFiles(); await project.planContracts();
  project.expectProblemAt('native-name-conflict', 1, 18); project.expectNoWritePlan();
  await project.expectProjectFilesUnchanged();
}, 60_000);

it('keeps legal native overloads distinguished by actual parameter types', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public saveTitle, saveCopies\ncapability saveTitle(title: Text) returns Text\ncapability saveCopies(copies: Number) returns Text\n}');
  project.options({ names: [{ declaration: ['StoreGame', 'saveTitle'], name: 'save' }, { declaration: ['StoreGame', 'saveCopies'], name: 'save' }] });
  await project.buildContracts();
  await project.implement('StoreGame.saveTitle', 'return "title:" + title');
  await project.implement('StoreGame.saveCopies', 'return "copies:" + copies');
  await project.runConsumer('fun main() { val game = store.StoreGame(); println(game.save("Dune")); println(game.save(2.0)) }');
  project.expectStdout('title:Dune\ncopies:2.0');
}, 120_000);

it('keeps equal mapped names in separate native scopes', async () => {
  const project = await KotlinDelivery.create();
  project.source('class First { public save\ncapability save(title: Text) returns Text\n}\nclass Second { public load\ncapability load(title: Text) returns Text\n}');
  project.options({ names: [{ declaration: ['First', 'save'], name: 'value' }, { declaration: ['Second', 'load'], name: 'value' },
    { declaration: ['First', 'save', 'title'], name: 'text' }, { declaration: ['Second', 'load', 'title'], name: 'text' }] });
  await project.buildContracts();
  await project.implement('First.save', 'return "first:" + text');
  await project.implement('Second.load', 'return "second:" + text');
  await project.runConsumer('fun main() { println(store.First().value("Dune")); println(store.Second().value("Foundation")) }');
  project.expectStdout('first:Dune\nsecond:Foundation');
}, 120_000);
