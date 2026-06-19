import { describe, it, expect } from 'vitest'
import { toQuestionnaire } from './to-questionnaire'
import { fromQuestionnaire } from './from-questionnaire'
import { toQuestionnaireResponse } from './response'
import { ObservationExtractor } from './extract/extract'
import { toTransactionBundle } from './to-transaction-bundle'
import { makeField, makeSchema, definitionOf } from './__fixtures__/forms'

const ctx = { subject: { reference: 'Patient/p1' }, authored: '2026-06-04T00:00:00Z' }

describe('observationExtract round-trip', () => {
  it('preserves the observationExtract flag through to/from Questionnaire', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      fields: [makeField({ id: 'hgb', displayLabel: 'Hgb', fieldType: 'number', order: 0, observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7' }] })],
    })
    expect(definitionOf(fromQuestionnaire(toQuestionnaire(model)))).toEqual(definitionOf(model))
  })
})

describe('ObservationExtractor', () => {
  it('emits a coded Observation carrying the answer (golden)', () => {
    const model = makeSchema({
      id: 'scr', name: 'Screening',
      fields: [makeField({ id: 'hgb', displayLabel: 'Hemoglobin', fieldType: 'number', order: 0, unit: 'g/dL', observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] })],
    })
    const q = toQuestionnaire(model)
    const qr = toQuestionnaireResponse(model, { hgb: 12.5 })
    expect(ObservationExtractor.extract(qr, q, ctx)).toEqual([
      {
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2026-06-04T00:00:00Z',
        valueQuantity: { value: 12.5, unit: 'g/dL', code: 'g/dL', system: 'http://unitsofmeasure.org' },
      },
    ])
  })

  it('does not extract fields not flagged for observation', () => {
    const model = makeSchema({ id: 'f', name: 'F', fields: [makeField({ id: 'note', displayLabel: 'Note', fieldType: 'text', order: 0 })] })
    const q = toQuestionnaire(model)
    expect(ObservationExtractor.extract(toQuestionnaireResponse(model, { note: 'hi' }), q, ctx)).toEqual([])
  })

  it('emits one Observation per repeating-group instance', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      fields: [
        makeField({ id: 'g', displayLabel: 'Readings', fieldType: 'group', order: 0 }),
        makeField({ id: 'bp', displayLabel: 'BP', fieldType: 'number', order: 1, groupId: 'g', observationExtract: true, code: [{ system: 'http://loinc.org', code: '8480-6' }] }),
      ],
    })
    const q = toQuestionnaire(model)
    const qr = toQuestionnaireResponse(model, { g: [{ bp: 120 }, { bp: 130 }] })
    const obs = ObservationExtractor.extract(qr, q, ctx)
    expect(obs).toHaveLength(2)
    expect(obs.map((o) => (o as { valueQuantity?: { value?: number } }).valueQuantity?.value)).toEqual([120, 130])
  })
})

describe('toTransactionBundle', () => {
  it('packages the response + extracted resources as a transaction', () => {
    const model = makeSchema({
      id: 'scr', name: 'Screening',
      fields: [makeField({ id: 'hgb', displayLabel: 'Hgb', fieldType: 'number', order: 0, observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7' }] })],
    })
    const q = toQuestionnaire(model)
    const qr = toQuestionnaireResponse(model, { hgb: 12 })
    const bundle = toTransactionBundle(qr, ObservationExtractor.extract(qr, q, ctx))
    expect(bundle.resourceType).toBe('Bundle')
    expect(bundle.type).toBe('transaction')
    expect(bundle.entry?.[0].resource?.resourceType).toBe('QuestionnaireResponse')
    expect(bundle.entry?.[1].resource?.resourceType).toBe('Observation')
    expect(bundle.entry?.[1].request).toEqual({ method: 'POST', url: 'Observation' })
  })
})
