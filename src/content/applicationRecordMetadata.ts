import type { ApplicationPageMetadata } from '../shared/types.ts';

function normalizeCompanyName(value: string): string {
  return value.replace(/招聘官网|校园招聘|社会招聘|招聘|校招|职位|官网/g, '').trim();
}

function pickCompanyName(doc: Document): string {
  const metaValue = doc
    .querySelector('meta[property="og:site_name"]')
    ?.getAttribute('content')
    ?.trim();
  if (metaValue) {
    return normalizeCompanyName(metaValue);
  }

  const title = doc.title.trim();
  const matched = title.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·\-.&\s]+?)(?:校园招聘|社会招聘|招聘|校招|职位)/);
  return normalizeCompanyName(matched?.[1] ?? '');
}

function readText(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
}

function findJobPosting(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, any>;
    const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
    if (types.some(type => String(type).toLowerCase() === 'jobposting')) return record;
    for (const nested of Object.values(record)) {
      const found = findJobPosting(nested);
      if (found) return found;
    }
  }
  return null;
}

function pickJobPosting(doc: Document): Record<string, any> | null {
  const scripts = typeof doc.querySelectorAll === 'function'
    ? Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
    : [];
  for (const script of scripts) {
    try {
      const posting = findJobPosting(JSON.parse(script.textContent || ''));
      if (posting) return posting;
    } catch {
      // Ignore malformed third-party structured data and continue with DOM selectors.
    }
  }
  return null;
}

function locationFromPosting(posting: Record<string, any> | null): string {
  const location = Array.isArray(posting?.jobLocation) ? posting?.jobLocation[0] : posting?.jobLocation;
  const address = location?.address || location;
  return [address?.addressLocality, address?.addressRegion, address?.addressCountry]
    .filter(Boolean).join(' · ').trim();
}

export function extractApplicationPageMetadata(doc: Document, url: string): ApplicationPageMetadata {
  const parsedUrl = new URL(url);
  const posting = pickJobPosting(doc);
  const jobTitle = String(posting?.title || posting?.name || '').trim() || readText(doc, [
    '[data-testid*="job-title" i]', '[class*="job-title" i]', '[class*="jobTitle"]',
    '[class*="position-title" i]', '[class*="positionTitle"]', 'main h1', 'h1',
  ]);
  const location = locationFromPosting(posting) || readText(doc, [
    '[data-testid*="location" i]', '[class*="job-location" i]', '[class*="jobLocation"]',
    '[class*="work-location" i]', '[class*="workLocation"]',
  ]);
  return {
    companyName: pickCompanyName(doc),
    sourceSite: parsedUrl.host,
    sourceUrl: parsedUrl.toString(),
    pageTitle: doc.title.trim(),
    jobTitle,
    location,
  };
}
