/** 将简历和旧数据中的政治面貌别名归一化为插件使用的标准值。 */
export function normalizePoliticalStatusValue(value?: string): string {
  const text = String(value || '').trim();
  if (/预备党员/.test(text)) return '中共预备党员';
  if (/中共党员|中国共产党党员|正式党员|^党员$/.test(text)) return '中共党员';
  if (/共青团员|^团员$/.test(text)) return '共青团员';
  if (/民主党派/.test(text)) return '民主党派';
  if (/无党派/.test(text)) return '无党派人士';
  if (/群众/.test(text)) return '群众';
  return text;
}
