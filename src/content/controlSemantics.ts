export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function isChoiceControl(element: FormControl): element is HTMLInputElement {
  return element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type);
}

export function getChoiceLabel(element: HTMLInputElement): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const explicit = element.id
    ? root.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent
    : '';
  return normalizeText(
    explicit
      || element.closest('label')?.textContent
      || element.getAttribute('aria-label')
      || element.value,
  );
}

export function getChoiceGroup(element: HTMLInputElement): HTMLInputElement[] {
  const root = element.getRootNode() as Document | ShadowRoot;
  if (!element.name) return [element];
  const selector = `input[type="${CSS.escape(element.type)}"][name="${CSS.escape(element.name)}"]`;
  const allChoices = Array.from(root.querySelectorAll<HTMLInputElement>(selector));
  const form = element.form;
  const scope = element.closest('form, fieldset, [role="group"], [role="radiogroup"]');
  const choices = allChoices.filter(choice => (
    form ? choice.form === form : choice.closest('form, fieldset, [role="group"], [role="radiogroup"]') === scope
  ));
  return choices.length > 0 ? choices : [element];
}

export function getChoiceGroupContainer(element: HTMLInputElement): HTMLElement | null {
  const group = getChoiceGroup(element);
  let current: HTMLElement | null = element.parentElement;
  let fallback: HTMLElement | null = null;
  for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) {
    if (!group.every(choice => current?.contains(choice))) continue;
    fallback ||= current;
    if (
      current.matches('fieldset, [role="group"], [role="radiogroup"], [data-form-field-id], [data-form-field-name], [class*=formItem], [class*=form-item], [class*=field]')
      || current.querySelector('legend, [class*=label], [class*=title]')
    ) return current;
    if (current.querySelectorAll('input, textarea, select').length > Math.max(8, group.length + 4)) break;
  }
  return fallback;
}

export function getChoiceQuestion(element: HTMLInputElement): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = normalizeText(labelledBy.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' '));
    if (text) return text;
  }

  const container = getChoiceGroupContainer(element);
  const candidates = [
    container?.getAttribute('data-form-field-i18n-name'),
    container?.getAttribute('aria-label'),
    container?.querySelector('legend')?.textContent,
    container?.querySelector(':scope > [class*="label" i], :scope > label, :scope > [class*="title" i]')?.textContent,
    container?.previousElementSibling?.textContent,
  ];
  const optionTexts = new Set(getChoiceGroup(element).map(getChoiceLabel).map(normalizeComparable));
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (!text || optionTexts.has(normalizeComparable(text))) continue;
    if (text.length <= 180) return text;
  }

  return normalizeText(element.name || element.getAttribute('aria-label') || getChoiceLabel(element));
}

export function getControlOptions(element: FormControl): string[] {
  if (isChoiceControl(element)) {
    return unique(getChoiceGroup(element).map(getChoiceLabel).filter(Boolean));
  }
  if (element instanceof HTMLSelectElement) {
    return unique(Array.from(element.options)
      .filter(option => !option.disabled && Boolean(option.value || option.text.trim()))
      .map(option => option.text.trim())
      .filter(Boolean));
  }
  if (element instanceof HTMLInputElement && element.getAttribute('role') === 'combobox') {
    const controlledId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
    const root = element.getRootNode() as Document | ShadowRoot;
    const controlled = controlledId ? root.getElementById(controlledId) : null;
    return unique(Array.from(controlled?.querySelectorAll<HTMLElement>('[role="option"]') || [])
      .map(option => normalizeText(option.textContent))
      .filter(Boolean));
  }
  return [];
}

export function getLogicalControlValue(element: FormControl): string {
  if (isChoiceControl(element)) {
    const selected = getChoiceGroup(element).filter(choice => choice.checked);
    return selected.map(choice => getChoiceLabel(choice) || choice.value).filter(Boolean).join(', ');
  }
  if (element instanceof HTMLInputElement && element.getAttribute('role') === 'combobox') {
    const container = element.closest<HTMLElement>(
      '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name], .ud__select, .ant-select, .el-select, .MuiAutocomplete-root, .react-select__control, .semi-select, .arco-select, [class*="cascader" i]'
    );
    const displayed = Array.from(container?.querySelectorAll<HTMLElement>([
      '.ud__select__selector__selectItem', '.ant-select-selection-item',
      '.ant-select-selection-item-content', '.el-select__selected-item',
      '.el-tag__content', '.MuiAutocomplete-tag .MuiChip-label',
      '.react-select__multi-value__label', '.semi-select-selection-text',
      '.arco-select-view-value', '[aria-selected="true"]',
    ].join(',')) || []).map(item => normalizeText(item.textContent)).filter(Boolean);
    return unique(displayed).join(', ') || element.value.trim();
  }
  return element.value.trim();
}

export function isLogicalChoiceRepresentative(element: FormControl): boolean {
  if (!isChoiceControl(element)) return true;
  const group = getChoiceGroup(element);
  return (group.find(choice => !choice.disabled) || group[0]) === element;
}

export function normalizeComparable(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[\s：:、，,。.;；()（）[\]【】]/g, '');
}

export function doesChoiceMatch(choiceValue: string, choiceLabel: string, desiredValue: string): boolean {
  const desired = normalizeComparable(desiredValue);
  const texts = [choiceValue, choiceLabel].map(normalizeComparable).filter(Boolean);
  if (!desired || texts.length === 0) return false;
  const yes = new Set(['true', 'yes', '1', '是', '同意', '接受', '已勾选']);
  const no = new Set(['false', 'no', '0', '否', '不同意', '不接受', '未勾选']);
  return texts.some(text => {
    if (text === desired) return true;
    if (yes.has(desired) && yes.has(text)) return true;
    if (no.has(desired) && no.has(text)) return true;
    const negative = (candidate: string) => /^[不非无未否]/.test(candidate);
    if (negative(text) !== negative(desired)) return false;
    return desired.length >= 2 && text.length >= 2 && (text.includes(desired) || desired.includes(text));
  });
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
