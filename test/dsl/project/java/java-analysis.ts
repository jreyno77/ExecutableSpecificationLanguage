import { expect, onTestFinished } from 'vitest';
import type { JavaAnalysis } from '../../../../src/project/java/java-analysis.js';
import { JavaAnalysisDriver } from '../../../driver/project/java/java-analysis.js';

type Answer = Awaited<ReturnType<JavaAnalysis['read']>>;

export async function nativeJava(source: string, dependency?: { catalogJar?: string; catalogSource?: string }): Promise<JavaAnalysisDriver> {
  const project = new JavaAnalysisDriver();
  onTestFinished(() => project.dispose());
  await project.prepare(source, dependency);
  return project;
}

export function expectFields(answer: Answer, type: string, names: string[]): void {
  expect(answer.problems).toEqual([]);
  expect(answer.facts.declarations.flatMap(item => item.type === type && item.member?.kind === 'field' ? [item.member.name] : []).sort()).toEqual([...names].sort());
}

export function expectFieldUse(answer: Answer, type: string, name: string): void {
  expect(answer.problems).toEqual([]);
  expect(answer.facts.uses.some(item => item.type === type && item.member?.kind === 'field' && item.member.name === name)).toBe(true);
}

export function expectRefusedAnalysis(answer: Answer, code: string): void {
  expect(answer.problems.map(problem => problem.code)).toContain(code);
  expect(answer.facts).toEqual({ format: 1, declarations: [], uses: [], problems: [], unresolved: [], comments: [] });
}

