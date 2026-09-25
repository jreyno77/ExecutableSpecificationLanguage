// antlr-ng 1.0.10's CLI exits successfully on grammar errors. Its public barrel
// also exports an erased type at runtime, so use the pinned Tool entry directly.
// Remove this guard when the upstream CLI reports failures correctly.
import { Tool } from "../node_modules/antlr-ng/dist/src/Tool.js";

const tool = new Tool(process.argv.slice(2));
tool.processGrammarsOnCommandLine();
process.exitCode = tool.getNumErrors() > 0 ? 1 : 0;
