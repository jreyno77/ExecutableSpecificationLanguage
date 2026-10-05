/** Package-relative resources shared by module consumers and the bundled CLI. */
export const packageMetadata = new URL('../package.json', import.meta.url);
export const javaResources = new URL('./project/java/resources/', import.meta.url);
export const kotlinResources = new URL('./project/kotlin/resources/', import.meta.url);
export const pythonRuntime = new URL('./project/python/runtime/', import.meta.url);
export const vitestEntry = new URL('./cli/cli-vitest.js', import.meta.url);
