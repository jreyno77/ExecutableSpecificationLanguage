import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../dsl/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed Java package consumers', () => {
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
