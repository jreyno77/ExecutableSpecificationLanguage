import { readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { ConfigurationReader, ProjectInitializer } = await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const manifest = join(process.cwd(), 'expec.json'), text = JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] },
  });
  await writeFile(manifest, text);
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const initializer = new ProjectInitializer(manifest, configuration.value);
  const prepared = await initializer.prepare({ root: input.root, target: input.target });
  const report = { prepared };
  if (prepared.value) {
    report.result = await initializer.apply(prepared.value, true);
    if (report.result.value) {
      const context = report.result.value.context, snapshot = await context.readSnapshot();
      report.connectedRoot = context.root;
      const requested = resolve(dirname(manifest), input.root);
      report.selectedRoot = { requested, actual: await realpath(requested) };
      report.snapshot = { ...snapshot, files: snapshot.files.map(file => ({ path: file.path, text: new TextDecoder().decode(file.bytes) })) };
      report.beforeBuildEntries = await readdir(context.root.path);
      const require = createRequire(import.meta.url), compiler = require.resolve('typescript/package.json');
      report.typescript = { version: JSON.parse(await readFile(compiler, 'utf8')).version, location: await realpath(compiler) };
      try {
        const built = await promisify(execFile)(process.execPath, [input.npm, 'run', 'build'], {
          cwd: context.root.path, windowsHide: true, timeout: 30_000,
          env: { ...process.env, PATH: join(dirname(dirname(compiler)), '.bin') + delimiter + process.env.PATH },
        });
        report.build = { code: 0, output: built.stdout + built.stderr };
      } catch (error) {
        if (typeof error.code !== 'number') throw error;
        report.build = { code: error.code, output: (error.stdout ?? '') + (error.stderr ?? '') };
      }
      if (report.build.code === 0) report.emitted = {
        'dist/index.js': await readFile(join(context.root.path, 'dist/index.js'), 'utf8'),
        'dist/index.d.ts': await readFile(join(context.root.path, 'dist/index.d.ts'), 'utf8'),
      };
    }
  }
  report.manifest = await readFile(manifest, 'utf8');
  process.stdout.write(JSON.stringify({ packageUrl, initialization: report }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
