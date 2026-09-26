import type { Inspection } from './inspection.js';
import { ResolutionQueryError, type DependencySnapshot, type Resolution } from './resolution/contracts.js';

/** Behavioral starting point: executable examples must disprove this empty report. */
export class Resolver {
  resolve(_inspection: Inspection, _dependencies: DependencySnapshot): Resolution {
    return {
      declarations: () => [],
      declaration: () => { throw new ResolutionQueryError('unknown-declaration', 'No declaration was resolved'); },
      binding: () => { throw new ResolutionQueryError('not-analyzed', 'No reference was analyzed'); },
      problems: [],
      deferred: [],
    };
  }
}

