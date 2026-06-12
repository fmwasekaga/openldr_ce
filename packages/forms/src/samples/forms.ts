import type { FormSchema } from '../schema/form-schema';

export function patientIntakeForm(): FormSchema {
  return {
    id: 'patient-intake', name: 'PatientIntake', title: { en: 'Patient Intake', fr: 'Admission patient' },
    status: 'active', languages: ['en', 'fr'],
    sections: [
      {
        id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
        fields: [
          { id: 'family', type: 'string', label: { en: 'Family name', fr: 'Nom' }, required: true, fhirPath: 'name.0.family' },
          { id: 'given', type: 'string', label: { en: 'Given name', fr: 'Prénom' }, required: true, fhirPath: 'name.0.given.0' },
          { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female', fr: 'Féminin' } }, { code: 'male', display: { en: 'Male', fr: 'Masculin' } }] },
          { id: 'birthDate', type: 'date', label: { en: 'Date of birth' }, fhirPath: 'birthDate' },
        ],
      },
    ],
  };
}

export function requisitionForm(): FormSchema {
  return {
    id: 'requisition', name: 'Requisition', title: { en: 'Test Requisition' },
    status: 'active', languages: ['en'],
    sections: [
      {
        id: 'order', title: { en: 'Order' }, resourceType: 'ServiceRequest',
        fields: [
          { id: 'status', type: 'string', label: { en: 'Status' }, fhirPath: 'status' },
          { id: 'intent', type: 'string', label: { en: 'Intent' }, fhirPath: 'intent' },
          { id: 'patientRef', type: 'reference', label: { en: 'Patient' }, required: true, fhirPath: 'subject' },
        ],
      },
    ],
  };
}

export function sampleForms(): FormSchema[] {
  return [patientIntakeForm(), requisitionForm()];
}
