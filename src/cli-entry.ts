#!/usr/bin/env node
import { runCli } from './cli/cli.js';
process.exitCode = await runCli(process.argv.slice(2));
