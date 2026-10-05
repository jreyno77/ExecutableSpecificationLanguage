import { KotlinDeliveryDriver } from './kotlin-delivery.js';

/** Exercises real captured Kotlin mappings without installing or executing the mapped type. */
export class KotlinImportsDriver extends KotlinDeliveryDriver {
  before = new Map<string, string>();
  after = new Map<string, string>();
  async prepare(): Promise<void> { await this.initialize(); await this.configureNative(); }
  async inspectPlan(): Promise<void> {
    this.before = await this.capturedFiles();
    await this.plan();
    this.after = await this.capturedFiles();
  }
}
