import type { Origin } from '../model/model.js';
import type { ProblemLocation } from './resolution/problem.js';
import type { TypeFact } from './type-description.js';
import { retainNames } from './name-evidence.js';

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly at: ProblemLocation;
  readonly related: readonly ProblemLocation[];
}
export interface Requirement { readonly reason: string; readonly origin: Origin; readonly requires: string }
export interface Check<T = never> {
  readonly value?: T;
  readonly problems: readonly Diagnostic[];
  readonly deferred: readonly Requirement[];
}

/** Combining checks retains the original causes, including independent missing prerequisites. */
export function mergeChecks(...checks: readonly Check<unknown>[]): Check {
  return retainNames({ problems: [...new Set(checks.flatMap(check => check.problems))],
    deferred: [...new Set(checks.flatMap(check => check.deferred))] }, ...checks);
}
export function fromFact<T>(fact: TypeFact<T>): Check<T> {
  return fact.status === 'known' ? { value: fact.value, problems: [], deferred: [] }
    : fact.status === 'invalid' ? { problems: fact.problems, deferred: fact.deferred }
    : { problems: [], deferred: fact.requirements };
}
