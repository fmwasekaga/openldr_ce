import type { DocGuide, DocSection } from './registry';

export interface DocsValidationError {
  code: string;
  message: string;
  slug?: string;
}

export type CaptureStep =
  | { action: 'click'; role: string; name: string }
  | { action: 'clickTestId'; testId: string }
  | { action: 'fill'; label: string; value: string }
  | { action: 'selectText'; text: string }
  | { action: 'waitForText'; text: string };

export interface ScreenshotManifestShot {
  name: string;
  guide: string;
  route: string;
  purpose: string;
  fixture: string;
  theme: 'dark' | 'light';
  ready: { kind: 'selector' | 'text'; value: string };
  steps: CaptureStep[];
  crop?: string;
  mask?: string[];
  callouts?: Array<{ number: number; selector: string; offsetX?: number; offsetY?: number }>;
}

export interface ScreenshotManifest {
  version: number;
  viewport: { width: number; height: number };
  shots: ScreenshotManifestShot[];
}

const LINK_RE = /(?<!!)\[[^\]]*]\(([^)]+)\)/g;
const IMAGE_RE = /!\[([^\]]*)]\(([^)]+)\)/g;

export function markdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(LINK_RE)]
    .map((match) => match[1].trim())
    .filter((href) => isInternalDocsLink(href));
}

export function markdownImages(markdown: string): Array<{ alt: string; src: string }> {
  return [...markdown.matchAll(IMAGE_RE)].map((match) => ({
    alt: match[1],
    src: match[2].trim(),
  }));
}

function isInternalDocsLink(href: string): boolean {
  if (/^https?:\/\//i.test(href)) return false;
  if (href.startsWith('#')) return false;
  if (href.startsWith('/')) return href.startsWith('/docs/');
  return true;
}

function slugFromLink(href: string): string {
  const withoutHash = href.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  const docsMatch = withoutQuery.match(/^\/docs\/([^/]+)/);
  if (docsMatch) return docsMatch[1];
  return withoutQuery
    .replace(/^(\.\/|\.\.\/)+/, '')
    .replace(/\.md$/i, '')
    .replace(/^docs\//, '')
    .split('/')[0];
}

function basename(src: string): string {
  return src.split(/[\\/]/).pop() ?? src;
}

function isExternalOrAbsolute(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('/');
}

function hasDhis2(value: unknown): boolean {
  return /dhis2/i.test(typeof value === 'string' ? value : JSON.stringify(value));
}

function error(code: string, message: string, slug?: string): DocsValidationError {
  return { code, message, slug };
}

export function validateDocs(
  sections: DocSection[],
  guides: DocGuide[],
  manifest: ScreenshotManifest,
  availableScreenshotNames: string[],
): DocsValidationError[] {
  const errors: DocsValidationError[] = [];
  const guideSlugs = new Set(guides.map((guide) => guide.slug));
  const guideScreenshotNames = new Set(guides.flatMap((guide) => guide.screenshotNames));
  const manifestNames = manifest.shots.map((shot) => shot.name);
  const manifestNameSet = new Set(manifestNames);
  const availableNameSet = new Set(availableScreenshotNames);

  for (const guide of guides) {
    if (hasDhis2(guide)) {
      errors.push(error('dhis2-reference', `Guide ${guide.slug} references DHIS2.`, guide.slug));
    }

    for (const relatedSlug of guide.relatedSlugs) {
      if (hasDhis2(relatedSlug)) {
        errors.push(
          error('dhis2-reference', `Related guide ${relatedSlug} references DHIS2.`, guide.slug),
        );
      }
      if (!guideSlugs.has(relatedSlug)) {
        errors.push(
          error('unknown-related-slug', `Related guide ${relatedSlug} does not exist.`, guide.slug),
        );
      }
    }

    for (const screenshotName of guide.screenshotNames) {
      if (hasDhis2(screenshotName)) {
        errors.push(
          error('dhis2-reference', `Screenshot ${screenshotName} references DHIS2.`, guide.slug),
        );
      }
      if (!manifestNameSet.has(screenshotName)) {
        errors.push(
          error(
            'missing-manifest-shot',
            `Guide screenshot ${screenshotName} is absent from the manifest.`,
            guide.slug,
          ),
        );
      }
      if (!availableNameSet.has(screenshotName)) {
        errors.push(
          error(
            'missing-screenshot-asset',
            `Guide screenshot ${screenshotName} has no bundled PNG asset.`,
            guide.slug,
          ),
        );
      }
    }
  }

  for (const section of sections) {
    if (hasDhis2(section.slug)) {
      errors.push(error('dhis2-reference', `Section ${section.slug} references DHIS2.`, section.slug));
    }

    const declaredImages = new Set(section.screenshotNames);
    for (const link of markdownLinks(section.content)) {
      if (hasDhis2(link)) {
        errors.push(error('dhis2-reference', `Link ${link} references DHIS2.`, section.slug));
      }
      const targetSlug = slugFromLink(link);
      if (targetSlug && !guideSlugs.has(targetSlug)) {
        errors.push(error('broken-link', `Docs link ${link} points to an unknown guide.`, section.slug));
      }
    }

    for (const image of markdownImages(section.content)) {
      if (image.alt.trim() === '') {
        errors.push(error('missing-image-alt', `Image ${image.src} is missing alt text.`, section.slug));
      }
      if (isExternalOrAbsolute(image.src)) continue;
      const imageName = basename(image.src);
      if (hasDhis2(imageName)) {
        errors.push(error('dhis2-reference', `Image ${imageName} references DHIS2.`, section.slug));
      }
      if (!declaredImages.has(imageName)) {
        errors.push(
          error(
            'undeclared-image',
            `Markdown image ${imageName} is not declared by guide metadata.`,
            section.slug,
          ),
        );
      }
    }
  }

  const seenManifestNames = new Set<string>();
  for (const shot of manifest.shots) {
    if (seenManifestNames.has(shot.name)) {
      errors.push(error('duplicate-manifest-shot', `Manifest output ${shot.name} is duplicated.`, shot.guide));
    }
    seenManifestNames.add(shot.name);

    if (hasDhis2([shot.name, shot.guide, shot.route, shot.purpose])) {
      errors.push(error('dhis2-reference', `Manifest shot ${shot.name} references DHIS2.`, shot.guide));
    }
    if (!guideSlugs.has(shot.guide)) {
      errors.push(error('unknown-manifest-guide', `Manifest guide ${shot.guide} does not exist.`, shot.guide));
    }
    if (!guideScreenshotNames.has(shot.name)) {
      errors.push(
        error(
          'unreferenced-manifest-shot',
          `Manifest output ${shot.name} is not referenced by any guide.`,
          shot.guide,
        ),
      );
    }
  }

  return errors;
}
