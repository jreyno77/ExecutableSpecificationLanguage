import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../../../dsl/project/kotlin/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('updates an existing parameter annotation while retaining its implementation and comments', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(value: Text) returns Text');
  await project.buildContracts();
  await project.implement('save', '// preserve this implementation\n    return "saved"');
  project.change('function save(value: Number) returns Text');
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/save.kt', 'fun save(value: Double): String');
  project.expectFileContains('src/main/kotlin/store/save.kt', '// preserve this implementation\n    return "saved"');
  project.expectNativeParameters('save', ['kotlin.Double']);
  await project.runConsumer('fun main() { println(store.save(1.0)) }');
  project.expectStdout('saved');
}, 180_000);

it('refuses a competing handwritten parameter annotation without changing any project byte', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(value: Text) returns Text');
  await project.buildContracts();
  await project.file('src/main/kotlin/store/save.kt', 'package store\nfun save(value: CharSequence): String { return "saved" }\n');
  project.change('function save(value: Number) returns Text');
  await project.expectUpdateRefused('output-conflict');
}, 120_000);

it('does not redirect a surviving caller to another overload after a parameter type change', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(value: Text) returns Text');
  await project.buildContracts(); await project.implement('save', 'return "owned"');
  await project.file('src/main/kotlin/store/Other.kt', 'package store\nfun save(value: Any): String = "other"\nfun launch(): String = save("Dune")\n');
  project.change('function save(value: Number) returns Text');
  await project.expectUpdateRefused('native-binding-changed');
}, 120_000);

it('does not discard a comment inside an authored generic parameter annotation', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(values: List<Text>) returns Text');
  await project.buildContracts();
  await project.file('src/main/kotlin/store/save.kt', 'package store\nfun save(values: MutableList</* retain */ String>): String { return "saved" }\n');
  project.change('function save(values: List<Number>) returns Text');
  await project.expectUpdateRefused('output-conflict');
}, 120_000);
