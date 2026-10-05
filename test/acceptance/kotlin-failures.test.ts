import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('retains each declared error code and payload in the native exception', async () => {
  const project = await KotlinDelivery.create();
  project.source('error type Rejected { code: "missing" | "rejected"\ndetail: Text }');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun main() {
    val failure = RejectedException(Rejected(RejectedCode.Missing, "Dune"))
    println(failure.details.code.value + ":" + failure.details.detail + ":" + failure.message)
}`);
  project.expectStdout('missing:Dune:missing');
}, 60_000);

it('does not let an authored Unit replace the Nothing result meaning', async () => {
  const project = await KotlinDelivery.create();
  project.source('class Unit {}\nfunction save() returns Nothing');
  await project.buildContracts();
  await project.compileConsumer('fun consume(): kotlin.Unit = store.save()');
  project.expectNativeCompilationPassed();
}, 60_000);

it('keeps generated failures independent of identically named application classes', async () => {
  const project = await KotlinDelivery.create();
  project.source('class NotImplementedError {}\nclass RuntimeException {}\nclass String {}\nerror type Rejected { code: "rejected" }\nfunction save() returns Nothing');
  await project.buildContracts();
  await project.runConsumer('fun main() { store.save() }');
  project.expectUnimplemented('save');
}, 60_000);

it('uses a named finite code alias without inventing a second code type', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Codes = "missing" | "rejected"\nerror type Rejected { code: Codes }');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun main() { val code: Codes = Codes.Missing; println(RejectedException(Rejected(code)).message) }`);
  project.expectStdout('missing');
}, 60_000);
