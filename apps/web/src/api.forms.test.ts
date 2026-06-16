import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForm, deleteForm, formQuestionnaireUrl, getForm, listForms, setFormStatus, submitFormResponse } from './api';

describe('forms api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'form-1' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('calls the forms endpoints', async () => {
    await listForms();
    await getForm('form-1');
    await createForm({ name: 'Specimen intake', schema: { sections: [] } });
    await setFormStatus('form-1', 'published');
    await submitFormResponse('form-1', { patientId: 'P-100' });
    await deleteForm('form-1');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/forms');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/forms/form-1');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/forms', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/forms/form-1/status', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(5, '/api/forms/form-1/responses', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(6, '/api/forms/form-1', expect.objectContaining({ method: 'DELETE' }));
    expect(formQuestionnaireUrl('form-1')).toBe('/api/forms/form-1/questionnaire');
  });
});
