export type Ris = 'R' | 'I' | 'S';
export type Origin = 'inpatient' | 'outpatient' | 'unknown';

export interface RawOrgObs { id: string; subjectRef: string | null; specimenRef: string | null; valueCode: string | null; valueText: string | null; date: string | null }
export interface RawAstObs { id: string; subjectRef: string | null; specimenRef: string | null; antibiotic: string | null; ris: string | null; date: string | null }
export interface RawSpecimen { id: string; typeCode: string | null; receivedTime: string | null; origin: string | null }
export interface RawPatient { id: string; gender: string | null; birthDate: string | null }

export interface Isolate {
  patientId: string;
  specimenType: string;
  origin: Origin;
  pathogenCode: string;
  pathogenName: string;
  date: string | null;
  gender: string;
  ageBand: string;
  results: { antibiotic: string; ris: Ris }[];
}
