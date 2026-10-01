import { expect } from 'vitest';
import { ReadableInspectionDriver } from '../driver/readable-inspection.js';

export class ReadableInspection {
  private readonly driver = new ReadableInspectionDriver();

  sourceIs(sourceId: string, text: string): void { this.driver.sourceIs(sourceId, text); }

  expectCapabilityNames(names: string[]): void {
    expect(this.driver.capabilityNames(), 'Names directly available on queried capabilities').toEqual(names);
  }

  expectCapabilityInputs(inputs: string[][]): void {
    expect(this.driver.capabilityInputs(), 'Names directly available on ordered capability inputs').toEqual(inputs);
  }
}
