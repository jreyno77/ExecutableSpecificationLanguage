import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../../../dsl/package/installed-package.js';

beforeAll(() => PackageExamples.prepareInstalled());
afterAll(() => PackageExamples.finish());

describe('Installed Java package consumers', () => {
  it('initializes, installs, builds, tests and safely renames a real Java basket through the installed command', async () => {
    const consumer = new PackageExamples(); await consumer.installCurrentPackage();
    const examples = '\nexamples { setup available(title: Text)\naction add(title: Text)\nobservation quantity(title: Text) returns Number\ncheck expectBookQuantity(title: Text, expected: Number) { assert quantity(title) == expected }\nscenario "a shopper adds Dune" { given available("Dune")\nwhen add("Dune")\nthen expectBookQuantity("Dune", 1) } }';
    await consumer.runJavaCommands('class StoreGame { public save\ncapability save(title: Text) returns Nothing }' + examples,
      'class StoreGame { public saveGame\ncapability saveGame(title: Text) returns Nothing }' + examples);
    consumer.expectInstalledJavaWorkflow(); consumer.expectInstalledPackageUsed();
  }, 360_000);
  it('preserves and queries a Java implementation through the installed public package and runs its renamed caller', async()=>{
    const consumer=new PackageExamples(); await consumer.installCurrentPackage();
    await consumer.preserveJava({
      source:'class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }',
      revised:'class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }',
      implementation:'package store; public class StoreGame { private int saves; public void save(String snapshot) { saves++; System.out.println(snapshot); } }\n',
      caller:'public class Caller { public static void main(String[] args) { new store.StoreGame().save("Dune"); } }\n',
    });
    consumer.expectAdoptedSourceUnchanged();
    consumer.expectPreservedNativeSource('private int saves; public void saveGame(String snapshot) { saves++; System.out.println(snapshot); }');
    consumer.expectPreservedCaller('new store.StoreGame().saveGame("Dune")'); consumer.expectPreservedRuntimeOutput('Dune');
    consumer.expectJavaNativeConsumer(); consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer(); consumer.expectDeclarationsAccepted();
  });
});
