import type { DocSection } from '../registry';

/** The raw markdown for one section. */
export function sectionToMarkdown(section: DocSection): string {
  return section.content;
}

/** All sections concatenated in order, separated by a horizontal rule. */
export function manualToMarkdown(sections: DocSection[]): string {
  return sections.map((s) => s.content.trim()).join('\n\n---\n\n');
}
