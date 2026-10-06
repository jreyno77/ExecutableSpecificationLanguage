import { it } from 'vitest';
import { KotlinImports } from '../../../dsl/project/kotlin/kotlin-native-imports.js';

it('proves mapped generic bounds with the declared type parameter rather than a concrete stand-in', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type Box<T>');
  project.map('Box', 'catalog.NativeBox');
  await project.nativeFile('src/main/kotlin/catalog/NativeBox.kt', 'package catalog\nclass NativeBox<T : Number>');
  await project.expectMappingRefused(1, 1);
}, 120_000);

it('does not replace a supplied source while staging a native import proof', async () => {
  const project = await KotlinImports.connect();
  project.source('opaque type URL');
  project.map('URL', 'java.net.URI');
  await project.nativeFile('src/main/kotlin/__expec_import_0.kt', 'package author\nclass Kept');
  await project.expectMappingAccepted();
}, 120_000);
