import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { FileProjectWriter, KotlinProject, type ProjectSnapshot, type WriteResult } from '../../src/index.js';
import { KotlinDeliveryDriver } from './kotlin-delivery.js';

/** Replaces a real compiled dependency at its existing path; all captures stay native. */
export class KotlinInputsDriver extends KotlinDeliveryDriver {
  captured!: ProjectSnapshot;
  receipt!: WriteResult;
  private cacheVersion = 0;
  library = '';
  replacement = '';
  async prepare(): Promise<void> {
    await this.initialize();
    this.library = join(this.directory, 'catalog.jar'); this.replacement = join(this.directory, 'replacement.jar');
    await this.libraryVersion('public String title() { return "Dune"; }', this.library);
    await this.libraryVersion('public int title() { return 7; }', this.replacement);
    await this.configureNative([this.library]);
    const path = '.expec/kotlin/classpath.json', report = JSON.parse((await this.capturedFiles()).get(path)!);
    report.classPath.main.push(this.library); report.runtimeClassPath.main.push(this.library);
    await this.file(path, JSON.stringify(report));
    await this.file('src/main/kotlin/store/Existing.kt', 'package store\nclass Existing { fun title(): String = catalog.Book().title() }\n');
  }
  private async libraryVersion(body: string, destination: string): Promise<void> {
    const native = await this.native(), root = join(this.directory, destination.endsWith('replacement.jar') ? 'second' : 'first');
    await fs.mkdir(root); const source = join(root, 'Book.java'), classes = join(root, 'classes'); await fs.mkdir(classes);
    await fs.writeFile(source, 'package catalog; public class Book { ' + body + ' }');
    const executable = (name: string) => join(dirname(native.java), name + (process.platform === 'win32' ? '.exe' : ''));
    for (const result of [await this.run(executable('javac'), ['-d', classes, source]), await this.run(executable('jar'), ['--create', '--file', destination, '-C', classes, '.'])])
      if (result.code) throw Error(result.stderr);
  }
  async capture(): Promise<void> { this.captured = await this.context.readSnapshot(); if (!this.captured.complete) throw Error(JSON.stringify(this.captured.problems)); }
  replaceLibrary(): Promise<void> { return fs.copyFile(this.replacement, this.library); }
  async searchCaptured(): Promise<void> {
    this.searchResult = await new KotlinProject({ outputId: 'kotlin' }, [{ specId: 'existing', locator: {
      outputId: 'kotlin', format: 'kotlin-symbol-1', value: { file: 'src/main/kotlin/store/Existing.kt', declaration: [{ kind: 'class', name: 'Existing' }] },
    } }]).search('existing', this.captured);
  }
  async planTwoContracts(): Promise<void> {
    this.source('class First {}\nclass Second {}'); await this.plan();
    if (!this.planned.value) throw Error(JSON.stringify(this.planned));
  }
  async apply(between = false): Promise<void> {
    let replaced = false; const context = this.context;
    this.receipt = await new FileProjectWriter(between ? { root: context.root, readSnapshot: async () => {
      if (!replaced && await fs.stat(join(this.root, 'src/main/kotlin/store/First.kt')).then(() => true, () => false)) {
        await this.replaceLibrary(); replaced = true;
      }
      return context.readSnapshot();
    } } : context).apply(this.planned.value!);
    this.files = await this.capturedFiles();
  }
  async changeCache(): Promise<void> { await this.file('build/cache.txt', 'unrelated cache version ' + ++this.cacheVersion); }
  async corruptSource(): Promise<Uint8Array> {
    const bytes = Uint8Array.from([0x70, 0x61, 0x63, 0x6b, 0x61, 0x67, 0x65, 0x20, 0xff, 0x0a]);
    await fs.writeFile(join(this.root, 'src/main/kotlin/store/Existing.kt'), bytes); return bytes;
  }
  async readCaptured(): Promise<void> {
    this.readResult = await new KotlinProject({ outputId: 'kotlin' }, [{ specId: 'existing', locator: {
      outputId: 'kotlin', format: 'kotlin-file-1', value: { file: 'src/main/kotlin/store/Existing.kt' },
    } }]).read('existing', this.captured);
  }
}
