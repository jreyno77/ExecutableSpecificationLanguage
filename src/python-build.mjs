import { cpSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../dist/python', import.meta.url), { recursive: true });
cpSync(new URL('./python', import.meta.url), new URL('../dist/python', import.meta.url), { recursive: true });
