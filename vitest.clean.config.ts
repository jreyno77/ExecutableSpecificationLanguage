import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['test/acceptance/clean-package.test.js'],passWithNoTests:false,maxWorkers:1}});
