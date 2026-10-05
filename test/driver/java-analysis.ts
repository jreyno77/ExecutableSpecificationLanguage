import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { vi } from 'vitest';
import * as inputs from '../../src/java-inputs.js';
import { JavaOutputDriver } from './java-output.js';

export class JavaAnalysisDriver extends JavaOutputDriver {
  nativeAnalyses = 0;
  private interrupt = false;
  private readonly restore: (() => void)[] = [];

  async prepare(source: string, dependency?: { catalogJar?: string; catalogSource?: string }): Promise<void> {
    await this.initialize();
    await this.file('src/main/java/store/Book.java', source);
    if (dependency?.catalogJar) await this.nativeCatalog(dependency.catalogJar);
    if (dependency?.catalogSource) await this.nativeSource('catalog/Book.java', dependency.catalogSource);
    const javaHome = process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Java analysis requires an explicit JAVA_HOME for JDK 21.');
    await this.configure(javaHome, this.nativeOptions);
    const build = ['settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar',
      'gradle/wrapper/gradle-wrapper.properties', '.expec/java/dependencies.gradle', 'gradle.lockfile'];
    for (const path of build) await this.file(path, 'native acquisition fixture');
    const reportInputs = await Promise.all(['expec.java.json', ...build].map(async path => ({
      path, version: createHash('sha256').update(await fs.readFile(join(this.root, path))).digest('hex'),
    })));
    await this.file('.expec/java/classpath.json', JSON.stringify({ format: 1, release: 21, javaHome,
      sourceRoots: { main: ['src/main/java'], test: ['src/test/java'] },
      classPath: { main: { compile: [], runtime: [] }, test: { compile: [], runtime: [] } }, packages: [], inputs: reportInputs,
    }));
    await this.capture();
    const spawn = childProcess.spawn;
    const observation = vi.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof spawn>) => {
      const child = Reflect.apply(spawn, childProcess, args);
      if (Array.isArray(args[1]) && args[1].includes('ExpecJava')) {
        this.nativeAnalyses++;
        if (this.interrupt) {
          this.interrupt = false;
          child.once('spawn', () => child.kill());
        }
      }
      return child;
    }) as typeof spawn);
    syncBuiltinESMExports();
    this.restore.push(() => { observation.mockRestore(); syncBuiltinESMExports(); });
  }

  replaceSourceBytes(source: string): void {
    this.replaceCapturedSource('src/main/java/store/Book.java', source);
  }
  changeCatalogJarBytes(): Promise<void> { return fs.appendFile(this.catalogJar, '\nchanged dependency\n'); }
  interruptNextNativeAnalysis(): void { this.interrupt = true; }

  changeExternalSourceAfterNextValidation(source: string): void {
    const read = inputs.javaInputs;
    const observation = vi.spyOn(inputs, 'javaInputs').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (args[0].root.path === this.root && !args[2]) {
        observation.mockRestore();
        await fs.writeFile(this.externalSource, source);
      }
      return result;
    });
    this.restore.push(() => observation.mockRestore());
  }

  override async dispose(): Promise<void> {
    for (const restore of this.restore.splice(0).reverse()) restore();
    await super.dispose();
  }
}
