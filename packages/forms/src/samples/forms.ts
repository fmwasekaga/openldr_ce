import type { FormSchema } from '../schema/form-schema'

const NOW = '2026-01-01T00:00:00.000Z'

function shell(over: Pick<FormSchema, 'id' | 'name' | 'fhirResourceType'>): Omit<FormSchema, 'fields' | 'sections'> {
  return {
    id: over.id,
    name: over.name,
    versionLabel: 'v1',
    fhirVersion: '4.0.1',
    fhirResourceType: over.fhirResourceType,
    fhirProfileUrl: null,
    facilityId: null,
    targetPages: [],
    version: 1,
    active: true,
    status: 'published',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** Patient intake / demographics → Questionnaire (extracts to Patient). */
export function patientIntakeForm(): FormSchema {
  return {
    ...shell({ id: 'sample-patient-intake', name: 'Patient intake', fhirResourceType: 'Patient' }),
    languages: ['fr', 'pt'],
    sections: [{ id: 'sec-demographics', label: 'Demographics', order: 0 }],
    fields: [
      {
        id: 'fld-name', fhirPath: 'Patient.name', displayLabel: 'Full name', description: null,
        fieldType: 'text', required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
        section: 'sec-demographics',
        translations: { fr: { label: 'Nom complet' }, pt: { label: 'Nome completo' } },
      },
      {
        id: 'fld-sex', fhirPath: 'Patient.gender', displayLabel: 'Sex', description: null,
        fieldType: 'select', required: true, enabled: true, order: 1, cardinality: { min: 1, max: '1' },
        section: 'sec-demographics',
        valueSetOptions: [
          { code: 'male', display: 'Male', translations: { fr: 'Homme', pt: 'Masculino' } },
          { code: 'female', display: 'Female', translations: { fr: 'Femme', pt: 'Feminino' } },
        ],
      },
      {
        id: 'fld-dob', fhirPath: 'Patient.birthDate', displayLabel: 'Date of birth', description: null,
        fieldType: 'date', required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' },
        section: 'sec-demographics',
      },
      {
        id: 'fld-phone', fhirPath: 'Patient.telecom', displayLabel: 'Phone', description: null,
        fieldType: 'phone', required: false, enabled: true, order: 3, cardinality: { min: 0, max: '1' },
        section: 'sec-demographics',
      },
    ],
  }
}

/** Lab requisition / order entry → Questionnaire (extracts to ServiceRequest). */
export function requisitionForm(): FormSchema {
  return {
    ...shell({ id: 'sample-requisition', name: 'Lab requisition', fhirResourceType: 'ServiceRequest' }),
    sections: [{ id: 'sec-order', label: 'Order', order: 0, fhirResourceType: 'ServiceRequest' }],
    fields: [
      {
        id: 'fld-ref', fhirPath: 'ServiceRequest.identifier', displayLabel: 'Reference number', description: 'External requisition number',
        fieldType: 'text', required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
        section: 'sec-order',
      },
      {
        id: 'fld-test', fhirPath: 'ServiceRequest.code', displayLabel: 'Test', description: null,
        fieldType: 'select', required: true, enabled: true, order: 1, cardinality: { min: 0, max: '1' },
        section: 'sec-order',
        valueSetOptions: [
          { code: '58410-2', display: 'CBC panel' },
          { code: '2339-0', display: 'Glucose' },
        ],
      },
      {
        id: 'fld-priority', fhirPath: 'ServiceRequest.priority', displayLabel: 'Priority', description: null,
        fieldType: 'select', required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' },
        section: 'sec-order',
        valueSetOptions: [
          { code: 'routine', display: 'Routine' },
          { code: 'urgent', display: 'Urgent' },
        ],
      },
      {
        id: 'fld-specimens', fhirPath: null, displayLabel: 'Specimens', description: null,
        fieldType: 'group', required: false, enabled: true, order: 3, cardinality: { min: 0, max: '1' },
        section: 'sec-order', minItems: 1, maxItems: 5,
      },
      {
        id: 'fld-spec-type', fhirPath: null, displayLabel: 'Specimen type', description: null,
        fieldType: 'select', required: true, enabled: true, order: 4, cardinality: { min: 1, max: '1' },
        groupId: 'fld-specimens',
        valueSetOptions: [
          { code: 'blood', display: 'Blood' },
          { code: 'urine', display: 'Urine' },
        ],
      },
      {
        id: 'fld-spec-volume', fhirPath: null, displayLabel: 'Volume', description: null,
        fieldType: 'number', required: false, enabled: true, order: 5, cardinality: { min: 0, max: '1' },
        groupId: 'fld-specimens', unit: 'mL',
      },
    ],
  }
}

/** All fresh sample forms. */
export function sampleForms(): FormSchema[] {
  return [patientIntakeForm(), requisitionForm()]
}
