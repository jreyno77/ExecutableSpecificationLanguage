import { PythonContractEdgesDriver } from './python-contract-edges.js';

/** Ordinary native mappings exercise the public plan and guarded create boundaries. */
export class PythonNativeImportsDriver extends PythonContractEdgesDriver {
  mapNativeImport(declaration: string, moduleName: string, name: string): void {
    this.options.imports = [{ module: 'main', declaration: [declaration], moduleName, name }];
  }
  override planContracts(): Promise<void> { return super.planContracts(this.options); }
}
