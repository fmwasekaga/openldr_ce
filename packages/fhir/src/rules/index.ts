import type { ClinicalRule } from './types';
import { resultRequiresRequest } from './result-requires-request';

export const CLINICAL_RULES: ClinicalRule[] = [resultRequiresRequest];
export * from './types';
