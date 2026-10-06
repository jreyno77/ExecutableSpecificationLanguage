import { cpSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../../../dist/project/python/resources', import.meta.url), { recursive: true });
cpSync(new URL('./resources', import.meta.url), new URL('../../../dist/project/python/resources', import.meta.url), { recursive: true });
