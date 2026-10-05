import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';

declare module 'vitest' { interface ProvidedContext { compiledCheckout: string } }
export function requireCompiledCheckout(): void {
  if (inject('compiledCheckout') !== fileURLToPath(new URL('../../', import.meta.url)))
    throw new Error('The test run must compile this checkout before starting its consumers.');
}
