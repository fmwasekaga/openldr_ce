import type { ReportTemplate } from './types';

export const MOCK_REPORTS = ['AMR resistance', 'Caseload by test', 'TAT by analyte'];

export const MOCK_TEMPLATES: ReportTemplate[] = [
  {
    id: 'rt-amr-summary',
    name: 'AMR summary',
    paper: 'A4',
    orientation: 'portrait',
    parameters: [
      { key: 'facility', label: 'Facility', value: 'Ndola' },
      { key: 'period', label: 'Period', value: 'Q2 2026' },
    ],
    pages: [
      {
        id: 'rt-amr-summary-p1',
        elements: [
          { id: 'amr-title', kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 500, h: 28 }, text: 'Antimicrobial resistance summary' },
          { id: 'amr-subtitle', kind: 'text', name: 'Subtitle', rect: { x: 48, y: 74, w: 500, h: 20 }, text: 'Q2 2026 · Ndola reference lab' },
          {
            id: 'amr-table', kind: 'table', name: 'Resistance table', rect: { x: 48, y: 120, w: 560, h: 200 },
            boundReport: 'AMR resistance', columns: ['Organism', '%R', 'n'],
            rows: [['E. coli', '62%', '418'], ['K. pneumoniae', '54%', '203'], ['S. aureus', '31%', '156']],
          },
          { id: 'amr-footer', kind: 'datetime', name: 'Footer date', rect: { x: 48, y: 1060, w: 300, h: 18 }, text: 'Generated {{date}} · Page 1 of 2' },
        ],
      },
      { id: 'rt-amr-summary-p2', elements: [
        { id: 'amr-p2-note', kind: 'text', name: 'Notes', rect: { x: 48, y: 40, w: 500, h: 40 }, text: 'Appendix: methodology' },
      ] },
    ],
  },
  {
    id: 'rt-monthly-caseload',
    name: 'Monthly caseload',
    paper: 'A4',
    orientation: 'portrait',
    parameters: [{ key: 'month', label: 'Month', value: 'June 2026' }],
    pages: [
      { id: 'rt-monthly-caseload-p1', elements: [
        { id: 'cl-title', kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 500, h: 28 }, text: 'Monthly caseload' },
        { id: 'cl-table', kind: 'table', name: 'Caseload table', rect: { x: 48, y: 100, w: 560, h: 160 }, boundReport: 'Caseload by test', columns: ['Test', 'Count'], rows: [['HIV VL', '1,204'], ['TB', '842']] },
      ] },
    ],
  },
  {
    id: 'rt-lab-tat',
    name: 'Lab TAT',
    paper: 'Letter',
    orientation: 'landscape',
    parameters: [],
    pages: [
      { id: 'rt-lab-tat-p1', elements: [
        { id: 'tat-title', kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 600, h: 28 }, text: 'Turnaround time' },
        { id: 'tat-table', kind: 'table', name: 'TAT table', rect: { x: 48, y: 100, w: 900, h: 160 }, boundReport: 'TAT by analyte', columns: ['Analyte', 'Median hrs', 'p90'], rows: [['CD4', '18', '42'], ['Chemistry', '6', '20']] },
      ] },
    ],
  },
];
