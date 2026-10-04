import { it } from 'vitest';
import { KotlinImports } from '../dsl/kotlin-native-imports.js';

it('refuses a missing native type referenced by a generated signature', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type URL\nfunction save(url: URL) returns Nothing');
  project.map('URL', 'java.net.DefinitelyMissing');
  await project.expectMappingRefused(1, 1);
}, 120_000);

it('checks an explicitly mapped type even before a callable uses it', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type URL');
  project.map('URL', 'java.net.DefinitelyMissing');
  await project.expectMappingRefused(1, 1);
}, 120_000);

it('refuses a declared generic mapping to a nongeneric native type', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type URL<T>');
  project.map('URL', 'java.net.URI');
  await project.expectMappingRefused(1, 1);
}, 120_000);

it('does not erase a required native generic parameter through a bare mapping', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type Titles');
  project.map('Titles', 'kotlin.collections.MutableList');
  await project.expectMappingRefused(1, 1);
}, 120_000);

it('retains a valid generic native mapping in an actual consumer', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type Items<T>\nfunction save(items: Items<Number>) returns Nothing');
  project.map('Items', 'kotlin.collections.MutableList');
  await project.buildContracts();
  await project.compileConsumer('fun consume(items: MutableList<Double>) { store.save(items) }');
  project.expectNoReplacement('Items');
}, 120_000);

it('retains a valid native import without demanding an unrelated handwritten body compiles', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type URL\nfunction save(url: URL) returns Nothing');
  project.map('URL', 'java.net.URI', 'NativeURI');
  await project.buildContracts();
  project.expectNoReplacement('URL');
  await project.compileConsumer('fun consume() { store.save(java.net.URI("https://example.test")) }');
  await project.nativeFile('src/main/kotlin/store/Unfinished.kt', 'package store\nfun unfinished(): String { return 1 }');
  await project.expectMappingAccepted();
}, 120_000);
