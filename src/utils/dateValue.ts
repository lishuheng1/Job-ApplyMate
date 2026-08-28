export interface ParsedFlexibleDate {
  year: number;
  month?: number;
  day?: number;
}

export interface DateControlHints {
  inputType?: string;
  placeholder?: string;
  pattern?: string;
  options?: string[];
}

export function parseFlexibleDate(value: string): ParsedFlexibleDate | null {
  const normalized = value.trim()
    .replace(/[年./]/g, '-')
    .replace(/[月]/g, '-')
    .replace(/[日]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const match = normalized.match(/^(19|20)\d{2}(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!match) return null;
  const year = Number(normalized.slice(0, 4));
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (month !== undefined && (month < 1 || month > 12)) return null;
  if (day !== undefined && (day < 1 || day > 31)) return null;
  return { year, month, day };
}

export function areEquivalentDates(left: string, right: string): boolean {
  const a = parseFlexibleDate(left);
  const b = parseFlexibleDate(right);
  if (!a || !b || a.year !== b.year) return false;
  if (a.month !== undefined && b.month !== undefined && a.month !== b.month) return false;
  if (a.day !== undefined && b.day !== undefined && a.day !== b.day) return false;
  return true;
}

export function adaptDateValue(value: string, hints: DateControlHints): string {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return value;
  const month = parsed.month ?? 1;
  const day = parsed.day ?? 1;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const inputType = (hints.inputType || '').toLowerCase();
  if (inputType === 'month') return `${parsed.year}-${mm}`;
  if (inputType === 'date') return `${parsed.year}-${mm}-${dd}`;

  const formatHint = `${hints.placeholder || ''} ${hints.pattern || ''}`.toLowerCase();
  if (/yyyy\s*\.\s*mm|年.*月|\d\{4\}\\?\.\d\{2\}/.test(formatHint)) return `${parsed.year}.${mm}`;
  if (/yyyy\s*\/\s*mm|\d\{4\}\\?\/\d\{2\}/.test(formatHint)) return `${parsed.year}/${mm}`;
  if (/yyyy\s*-\s*mm|\d\{4\}-\d\{2\}/.test(formatHint)) return `${parsed.year}-${mm}`;
  if (/yyyy\s*\.\s*m/.test(formatHint)) return `${parsed.year}.${month}`;
  if (/yyyy\s*\/\s*m/.test(formatHint)) return `${parsed.year}/${month}`;
  if (/yyyy\s*-\s*m/.test(formatHint)) return `${parsed.year}-${month}`;
  return value;
}

export function findDateOptionIndex(value: string, options: string[]): number {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return -1;
  const compact = options.map(option => option.trim().replace(/\s+/g, ''));
  const yearIndex = compact.findIndex(option => {
    const match = option.match(/^((?:19|20)\d{2})(?:年)?$/);
    return Boolean(match) && Number(match?.[1]) === parsed.year;
  });
  if (yearIndex >= 0) return yearIndex;

  if (parsed.month) {
    const monthNames = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ];
    const shortMonthNames = monthNames.map(name => name.slice(0, 3));
    const monthIndex = compact.findIndex(option => {
      const numeric = option.match(/^(0?[1-9]|1[0-2])(?:月|月份)?$/);
      if (numeric) return Number(numeric[1]) === parsed.month;
      const normalized = option.toLowerCase().replace(/\.$/, '');
      return monthNames[parsed.month! - 1] === normalized
        || shortMonthNames[parsed.month! - 1] === normalized;
    });
    if (monthIndex >= 0) return monthIndex;
  }
  return options.findIndex(option => areEquivalentDates(value, option));
}
