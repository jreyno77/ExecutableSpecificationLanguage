import { cpSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../../../dist/project/python/runtime', import.meta.url), { recursive: true });
cpSync(new URL('./runtime', import.meta.url), new URL('../../../dist/project/python/runtime', import.meta.url), { recursive: true });
