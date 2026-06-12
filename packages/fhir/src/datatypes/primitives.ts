import { z } from 'zod';

const ID_RE = /^[A-Za-z0-9.\-]{1,64}$/;
const CODE_RE = /^[^\s]+(\s[^\s]+)*$/;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATETIME_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const fhirId = z.string().regex(ID_RE, 'invalid FHIR id');
export const fhirUri = z.string().min(1);
export const fhirCode = z.string().regex(CODE_RE, 'invalid FHIR code');
export const fhirString = z.string().min(1);
export const fhirBoolean = z.boolean();
export const fhirDecimal = z.number();
export const fhirInteger = z.number().int();
export const fhirDate = z.string().regex(DATE_RE, 'invalid FHIR date');
export const fhirDateTime = z.string().regex(DATETIME_RE, 'invalid FHIR dateTime');
export const fhirInstant = z.string().regex(INSTANT_RE, 'invalid FHIR instant');
export const fhirBase64Binary = z.string();
