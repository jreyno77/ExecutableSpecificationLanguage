import type { PackageRequirementNode } from '../grammar/source.js';
import type { ResolutionProblem } from './problem.js';

export type PackagePhase = NonNullable<PackageRequirementNode['phase']>;
export interface DependencyPackage {
  readonly alias: string;
  readonly phases: readonly PackagePhase[];
}

interface ConfiguredPackage {
  readonly index: number;
  readonly phases: ReadonlySet<PackagePhase>;
  readonly problems: ResolutionProblem[];
}

const phases: ReadonlySet<PackagePhase> = new Set(['build', 'runtime', 'test']);

/** Checks supplied package configuration; availability is not installation. */
export class PackageAvailability {
  readonly problems: readonly ResolutionProblem[];
  private readonly packages = new Map<string, ConfiguredPackage>();

  constructor(packages: readonly DependencyPackage[]) {
    const problems: ResolutionProblem[] = [];
    packages.forEach((input, index) => {
      const configured: ConfiguredPackage = { index, phases: new Set(input.phases), problems: [] };
      const previous = this.packages.get(input.alias);
      if (previous) {
        const problem: ResolutionProblem = {
          code: 'invalid-dependency-input', message: `Duplicate package alias ${input.alias}.`,
          at: { kind: 'dependency', path: ['packages', index, 'alias'] },
          related: [{ kind: 'dependency', path: ['packages', previous.index, 'alias'] }],
        };
        previous.problems.push(problem);
        problems.push(problem);
      } else {
        this.packages.set(input.alias, configured);
      }

      const seen = new Map<PackagePhase, number>();
      input.phases.forEach((phase, ordinal) => {
        const earlier = seen.get(phase);
        let problem: ResolutionProblem | undefined;
        if (!phases.has(phase)) {
          problem = {
            code: 'invalid-dependency-input', message: `Unknown package phase ${phase}.`,
            at: { kind: 'dependency', path: ['packages', index, 'phases', ordinal] }, related: [],
          };
        } else if (earlier !== undefined) {
          problem = {
            code: 'invalid-dependency-input', message: `Duplicate package phase ${phase}.`,
            at: { kind: 'dependency', path: ['packages', index, 'phases', ordinal] },
            related: [{ kind: 'dependency', path: ['packages', index, 'phases', earlier] }],
          };
        }
        if (problem) {
          configured.problems.push(problem);
          problems.push(problem);
        }
        seen.set(phase, ordinal);
      });
    });
    this.problems = problems;
  }

  check(alias: string, phase?: PackagePhase): readonly ResolutionProblem[] {
    const supplied = this.packages.get(alias);
    if (!supplied) return [{
      code: 'unavailable-package', message: `Package ${alias} is not supplied.`,
      at: { kind: 'dependency', path: ['packages'] }, related: [],
    }];
    if (supplied.problems.length) return supplied.problems.slice();
    if (phase !== undefined && !supplied.phases.has(phase)) return [{
      code: 'unavailable-package', message: `Package ${alias} is not supplied for ${phase}.`,
      at: { kind: 'dependency', path: ['packages', supplied.index, 'phases'] }, related: [],
    }];
    return [];
  }
}
