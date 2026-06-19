import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createForm,
  deleteForm,
  duplicateForm,
  formQuestionnaireUrl,
  getForm,
  getFormVersion,
  listFormVersions,
  listForms,
  publishForm,
  setFormStatus,
  submitFormResponse,
  updateForm,
} from './api';

describe('forms api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'form-1' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('calls the forms endpoints', async () => {
    await listForms();
    await getForm('form-1');
    await createForm({ name: 'Specimen intake', schema: { fields: [] }, fhirVersion: '4.0.1', fhirProfileUrl: 'http://example.org/profile', facilityId: 'FAC-1' });
    await updateForm('form-1', { name: 'Specimen intake', schema: { fields: [] }, fhirVersion: '4.0.1', fhirProfileUrl: 'http://example.org/profile', facilityId: 'FAC-1' });
    await publishForm('form-1', { versionLabel: 'v1' });
    await duplicateForm('form-1');
    await listFormVersions('form-1');
    await getFormVersion('form-1', 1);
    await setFormStatus('form-1', 'published');
    await submitFormResponse('form-1', { patientId: 'P-100' });
    await deleteForm('form-1');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/forms');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/forms/form-1');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/forms', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/forms/form-1', expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(5, '/api/forms/form-1/publish', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(6, '/api/forms/form-1/duplicate', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(7, '/api/forms/form-1/versions');
    expect(fetch).toHaveBeenNthCalledWith(8, '/api/forms/form-1/versions/1');
    expect(fetch).toHaveBeenNthCalledWith(9, '/api/forms/form-1/status', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(10, '/api/forms/form-1/responses', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(11, '/api/forms/form-1', expect.objectContaining({ method: 'DELETE' }));
    expect(formQuestionnaireUrl('form-1')).toBe('/api/forms/form-1/questionnaire');
  });

  it('create/update payloads include fhirVersion, fhirProfileUrl and facilityId', async () => {
    await createForm({
      name: 'Test form',
      schema: { fields: [] },
      fhirVersion: '4.0.1',
      fhirProfileUrl: 'http://example.org/profile',
      facilityId: 'FAC-42',
    });
    const createCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }];
    const createBody = JSON.parse(createCall[1].body) as Record<string, unknown>;
    expect(createBody.fhirVersion).toBe('4.0.1');
    expect(createBody.fhirProfileUrl).toBe('http://example.org/profile');
    expect(createBody.facilityId).toBe('FAC-42');

    (fetch as ReturnType<typeof vi.fn>).mockClear();
    await updateForm('form-1', {
      name: 'Test form',
      schema: { fields: [] },
      fhirVersion: '4.0.1',
      fhirProfileUrl: 'http://example.org/profile',
      facilityId: 'FAC-42',
    });
    const updateCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }];
    const updateBody = JSON.parse(updateCall[1].body) as Record<string, unknown>;
    expect(updateBody.fhirVersion).toBe('4.0.1');
    expect(updateBody.fhirProfileUrl).toBe('http://example.org/profile');
    expect(updateBody.facilityId).toBe('FAC-42');
  });
});
