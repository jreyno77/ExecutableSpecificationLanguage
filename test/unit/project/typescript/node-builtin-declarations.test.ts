import { afterEach, describe, it } from 'vitest';
import { BuiltinDeclarations } from '../../../dsl/project/typescript/node-builtin-declarations.js';

afterEach(() => BuiltinDeclarations.clean());

describe('native Node builtin declarations', () => {
  it('uses the declared Node builtin even beside an installed JavaScript polyfill', async () => {
    const project = await BuiltinDeclarations.author({
      'ambient.d.ts': 'declare module "string_decoder" { export class StringDecoder { write(text: string): string; } }',
      'src/use.ts': 'import { StringDecoder } from "string_decoder"; export function decode(text: string) { return new StringDecoder().write(text); }',
    });
    await project.installedJavaScript('string_decoder', 'throw Error("polyfill body must stay unread");');
    project.forbidInstalledImplementationReads();
    await project.capture();
    project.expectComplete();
    project.expectDeclaredClassUsed('string_decoder', 'StringDecoder', 'ambient.d.ts', 'src/use.ts');
    project.expectNoInstalledJavaScriptConsumed();
  });

  it('keeps a nonbuiltin JavaScript package unsupported despite a same-name ambient declaration', async () => {
    const project = await BuiltinDeclarations.author({
      'ambient.d.ts': 'declare module "browser-decoder" { export class StringDecoder { write(text: string): string; } }',
      'src/use.ts': 'import { StringDecoder } from "browser-decoder"; export function decode(text: string) { return new StringDecoder().write(text); }',
    });
    await project.installedJavaScript('browser-decoder', 'throw Error("implementation must stay unread");');
    project.forbidInstalledImplementationReads();
    await project.capture();
    project.expectInstalledImplementationRefused('src/use.ts', '"browser-decoder"');
    project.expectNoInstalledJavaScriptConsumed();
  });

  it('does not invent builtin declarations when only a JavaScript polyfill is installed', async () => {
    const project = await BuiltinDeclarations.author({
      'src/use.ts': 'import { StringDecoder } from "string_decoder"; export function decode(text: string) { return new StringDecoder().write(text); }',
    });
    await project.installedJavaScript('string_decoder', 'throw Error("polyfill body must stay unread");');
    project.forbidInstalledImplementationReads();
    await project.capture();
    project.expectInstalledImplementationRefused('src/use.ts', '"string_decoder"');
    project.expectNoInstalledJavaScriptConsumed();
  });
});
