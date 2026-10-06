import { defineConfig } from 'vitest/config';

const target = process.env.EXPEC_CONSUMER_TARGET;
if (!target || !['java', 'kotlin', 'python'].includes(target)) throw Error('Select one native consumer: java, kotlin or python.');
export default defineConfig({ test: {
  include: [`test/acceptance/project/${target}/shipped-${target}-walkthrough.test.js`], maxWorkers: 1, passWithNoTests: false,
} });
