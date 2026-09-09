import { areEquivalentDates } from './dateValue.ts';

const EQUIVALENT_OPTION_GROUPS = [
  ['是', 'yes', 'true', '1', '同意', '接受'],
  ['否', 'no', 'false', '0', '不同意', '不接受'],
  ['男', 'male', 'm', '先生'],
  ['女', 'female', 'f', '女士'],
  ['高中', '中专', 'highschool'],
  ['专科', '大专', 'associate'],
  ['本科', '大学本科', '学士', 'bachelor'],
  ['硕士', '研究生', '硕士研究生', 'master'],
  ['博士', '博士研究生', 'phd', 'doctor', 'doctorate'],
  ['中共党员', '中国共产党党员', '正式党员', '党员'],
  ['中共预备党员', '中国共产党预备党员', '预备党员'],
  ['共青团员', '团员'],
  ['民主党派', '民主党派成员'],
  ['群众', '普通群众'],
  ['无党派', '无党派人士'],
  ['应届生', '应届毕业生', '在校生'],
  ['至今', '现在', '目前', 'present', 'current'],
];

const PLACEHOLDER_PATTERN = /^(?:请选择|选择|pleasechoose|pleaseselect|select|choose|全部|all)$/i;

export function normalizeDropdownText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:、，,。.;；()（）[\]【】×✕]/g, '');
}

function equivalentGroup(value: string): number {
  const normalized = normalizeDropdownText(value);
  return EQUIVALENT_OPTION_GROUPS.findIndex(group => (
    group.some(candidate => normalizeDropdownText(candidate) === normalized)
  ));
}

function isNegative(value: string): boolean {
  return /^(?:不|非|无|未|否|no|false)/i.test(normalizeDropdownText(value));
}

/**
 * Returns a confidence score for a dropdown option, or -1 when it is unsafe to
 * select. Exact/date/known-alias matches deliberately outrank partial text.
 */
export function scoreDropdownOption(desiredValue: string, optionText: string): number {
  const desired = normalizeDropdownText(desiredValue);
  const option = normalizeDropdownText(optionText);
  if (!desired || !option || PLACEHOLDER_PATTERN.test(option)) return -1;
  if (desired === option) return 1000;
  if (areEquivalentDates(desiredValue, optionText)) return 980;

  const desiredGroup = equivalentGroup(desiredValue);
  if (desiredGroup >= 0 && desiredGroup === equivalentGroup(optionText)) return 950;

  // 政治面貌是互斥枚举，禁止用“党员/党派”等共有子串做模糊匹配。
  const politicalPattern = /党员|团员|群众|党派/;
  if (politicalPattern.test(desired) || politicalPattern.test(option)) return -1;

  // Never let a positive answer match a visibly negative option merely because
  // one string contains the other (for example 全日制 / 非全日制, 是 / 是否).
  if (isNegative(desired) !== isNegative(option)) return -1;

  if (desired.length >= 2 && option.length >= 2) {
    if (option.startsWith(desired) || desired.startsWith(option)) return 820;
    if (option.includes(desired) || desired.includes(option)) return 760;
  }
  return -1;
}

export function findBestDropdownOptionIndex(desiredValue: string, options: string[]): number {
  let bestIndex = -1;
  let bestScore = -1;
  let tied = false;

  options.forEach((option, index) => {
    const score = scoreDropdownOption(desiredValue, option);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
      tied = false;
    } else if (score >= 0 && score === bestScore) {
      tied = true;
    }
  });

  // A low-confidence partial match is unsafe when several options are equally
  // plausible. Exact, date and known alias matches are stable even if duplicated.
  return tied && bestScore < 900 ? -1 : bestIndex;
}

export function dropdownValueMatches(actualValue: string, desiredValue: string): boolean {
  if (!actualValue.trim() || !desiredValue.trim()) return false;
  return scoreDropdownOption(desiredValue, actualValue) >= 900
    || scoreDropdownOption(actualValue, desiredValue) >= 900;
}

export function splitMultiDropdownValue(value: string): string[] {
  const parts = value.split(/[，,、;；|\n]+/).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [value.trim()];
}

export function splitCascaderValue(value: string): string[] {
  if (areEquivalentDates(value, value)) return [value.trim()];
  const parts = value.split(/(?:\s*[>＞]\s*|[／/])/).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [value.trim()];
}
