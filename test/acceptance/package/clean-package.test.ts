import { it } from 'vitest';
import { CleanPackage } from '../../dsl/package/clean-package.js';

it('uses the delivered commands and public declarations without a development checkout', async () => {
  const author=await CleanPackage.installed();
  await author.expectNoDevelopmentCheckout();
  await author.expectPrivateAndDevelopmentImportsUnavailable();
  await author.expectCommands(['check','build','test','init','install']);
  await author.expectVersion();
  await author.expectPublicCapability('save');
  await author.expectInstalledResources();
},180_000);
