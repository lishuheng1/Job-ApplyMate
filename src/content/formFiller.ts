import type { DetectedField, FillPreviewItem, LearnedFieldValue, UserProfile } from '../shared/types';
import { FieldType } from '../shared/types';
import { GENDER_OPTIONS } from '../shared/constants';
import { adaptDateValue, areEquivalentDates, findDateOptionIndex } from '../utils/dateValue';
import {
  dropdownValueMatches,
  findBestDropdownOptionIndex,
  normalizeDropdownText,
  splitCascaderValue,
  splitMultiDropdownValue,
} from '../utils/dropdownOption';
import { FieldMatcher } from '../utils/fieldMatcher';
import {
  getChoiceGroup,
  getChoiceLabel,
  getChoiceQuestion,
  getControlOptions,
  getLogicalControlValue,
  doesChoiceMatch,
  isChoiceControl,
  normalizeComparable,
} from './controlSemantics';

export type FillSection = 'all' | 'personal' | 'education' | 'experience' | 'projects';

export interface FillFailure {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  signature: string;
  fieldType: string;
  label: string;
  attemptedValue: string;
}

const EDUCATION_FIELD_TYPES = new Set<FieldType>([
  FieldType.SCHOOL,
  FieldType.COLLEGE,
  FieldType.EDUCATION_TYPE,
  FieldType.MAJOR,
  FieldType.MAJOR_CATEGORY,
  FieldType.DEGREE,
  FieldType.ACADEMIC_DEGREE,
  FieldType.GPA,
  FieldType.EDUCATION_START_DATE,
  FieldType.GRADUATION_DATE,
]);

const EXPERIENCE_FIELD_TYPES = new Set<FieldType>([
  FieldType.COMPANY,
  FieldType.POSITION,
  FieldType.START_DATE,
  FieldType.END_DATE,
  FieldType.DESCRIPTION,
]);

const PROJECT_FIELD_TYPES = new Set<FieldType>([
  FieldType.PROJECT_NAME,
  FieldType.PROJECT_ROLE,
  FieldType.PROJECT_START_DATE,
  FieldType.PROJECT_END_DATE,
  FieldType.PROJECT_DESCRIPTION,
  FieldType.PROJECT_ACHIEVEMENTS,
  FieldType.PROJECT_TECHNOLOGIES,
]);

export class FormFiller {
  private previousValues = new Map<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    { value: string; checked?: boolean; selectedIndex?: number }
  >();
  private failures = new Map<Element, FillFailure>();

  beginFillSession(): void {
    this.previousValues.clear();
    this.failures.clear();
  }

  getLastFailures(): FillFailure[] {
    return Array.from(this.failures.values());
  }

  markUnresolvedField(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    label = '',
  ): void {
    if (this.failures.has(element)) return;
    this.recordFailure(element, '', 'unknown', label);
  }

  getFieldSignature(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
    const container = element.closest<HTMLElement>(
      '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name], [class*=formItem], [class*=applyFormItem]'
    );
    const identifiers = FieldMatcher.extractIdentifiers(element);
    const source = (isChoiceControl(element) ? [
      element.type,
      element.name,
      getChoiceQuestion(element),
      getControlOptions(element).join('|'),
      identifiers.contextText,
    ] : [
      element.name,
      element.id,
      element.getAttribute('data-form-field-name') || '',
      element.getAttribute('data-form-field-id') || '',
      container?.getAttribute('data-form-field-name') || '',
      container?.getAttribute('data-form-field-id') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('placeholder') || '',
      identifiers.labelText,
      identifiers.contextText,
      element instanceof HTMLSelectElement ? getControlOptions(element).join('|') : '',
      element.type || element.tagName,
    ]).map(value => value.trim().toLowerCase()).filter(Boolean).join('\u001f');
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `field-v2-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  getCorrectionOptions(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
    return getControlOptions(element);
  }

  getLearnedValue(entry: LearnedFieldValue | undefined, profile: UserProfile): string {
    if (!entry) return '';
    if (!entry.profilePath) return entry.value;
    const resolved = readProfilePath(profile, entry.profilePath);
    return typeof resolved === 'string' && resolved.trim() ? resolved : entry.value;
  }

  async undoLastFill(): Promise<number> {
    let restored = 0;
    for (const [element, snapshot] of Array.from(this.previousValues.entries()).reverse()) {
      if (!element.isConnected) continue;
      if (element instanceof HTMLInputElement && snapshot.checked !== undefined) {
        element.checked = snapshot.checked;
      }
      if (element instanceof HTMLSelectElement && snapshot.selectedIndex !== undefined) {
        element.selectedIndex = snapshot.selectedIndex;
      } else if (element instanceof HTMLInputElement && element.getAttribute('role') === 'combobox') {
        if (snapshot.value) {
          await this.fillGenericCombobox(element, snapshot.value);
        } else {
          this.fillInputField(element, '');
        }
      } else if (!(element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type))) {
        this.fillInputField(element as HTMLInputElement | HTMLTextAreaElement, snapshot.value);
      }
      this.triggerEvents(element);
      restored++;
    }
    this.previousValues.clear();
    return restored;
  }
  // 字节等网申页面常见模式：经历条目需要先点击“添加”才会出现空白行
  async prepareDynamicSections(profile: UserProfile, section: FillSection = 'all'): Promise<boolean> {
    let changed = false;
    if (section === 'all' || section === 'education') {
      changed = await this.ensureEducationRows(profile.education.length) || changed;
    }
    if (section === 'all' || section === 'experience') {
      changed = await this.ensureExperienceRows(profile.experience.length) || changed;
    }
    if (section === 'all' || section === 'projects') {
      changed = await this.ensureProjectRows(profile.projects.length) || changed;
    }
    return changed;
  }

  async fillElementValues(
    values: Array<{
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      value: string;
    }>,
    shouldContinue: () => boolean = () => true
  ): Promise<number> {
    let filledCount = 0;

    for (const item of values) {
      if (!shouldContinue()) break;
      if (!item.value) continue;
      if (await this.fillField(item.element, item.value)) {
        this.failures.delete(item.element);
        filledCount++;
      } else {
        this.recordFailure(item.element, item.value, 'aiMatched');
      }
    }

    return filledCount;
  }

  async fillFocusedControl(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): Promise<boolean> {
    if (!element.isConnected || element.disabled) return false;

    const written = await this.fillField(element, value);
    if (!written) return false;
    await this.wait(100);

    if (element.tagName === 'SELECT') {
      const select = element as HTMLSelectElement;
      const selectedText = select.options[select.selectedIndex]?.text || '';
      return select.value === value || selectedText === value;
    }

    if (isChoiceControl(element)) {
      return Boolean(getLogicalControlValue(element));
    }

    if (element.getAttribute('role') === 'combobox' && element.closest('.ud__select')) {
      const container = element.closest<HTMLElement>(
        '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]'
      );
      const selectedText = (
        container?.querySelector('.ud__select__selector__selectItem')?.textContent || ''
      ).trim();
      return selectedText === value || element.value === value;
    }

    return element.value === value;
  }

  // 填充所有检测到的字段
  async fillForm(
    fields: DetectedField[],
    profile: UserProfile,
    learnedValues: Record<string, LearnedFieldValue> = {},
  ): Promise<void> {
    console.log(`Filling ${fields.length} form fields`);

    const educationIndexes: Partial<Record<FieldType, number>> = {};
    const experienceIndexes: Partial<Record<FieldType, number>> = {};
    const projectIndexes: Partial<Record<FieldType, number>> = {};
    const handledDateElements = await this.fillDateRangeFields(fields, profile, learnedValues);
    const orderedFields = fields.filter(field => !handledDateElements.has(field.element));

    for (const field of orderedFields) {
      try {
        const fieldType = field.fieldType as FieldType;
        const educationIndex = this.getEducationIndexForField(field, profile, educationIndexes);
        const experienceIndex = this.getNextExperienceIndex(fieldType, experienceIndexes);
        const projectIndex = this.getNextProjectIndex(fieldType, projectIndexes);
        const signature = this.getFieldSignature(field.element);
        const value = this.getLearnedValue(learnedValues[signature], profile)
          || this.getValueForField(fieldType, profile, educationIndex, experienceIndex, projectIndex);
        if (value !== null && value !== undefined) {
          if (await this.fillField(field.element, value)) {
            this.failures.delete(field.element);
          } else if (field.element instanceof HTMLInputElement
            && field.element.type === 'radio'
            && this.isRadioGroupSatisfied(field.element)) {
            this.failures.delete(field.element);
          } else {
            this.recordFailure(field.element, value, fieldType);
          }
        } else if (field.element.required || field.element.getAttribute('aria-required') === 'true') {
          this.recordFailure(field.element, '', fieldType);
        }
      } catch (error) {
        console.error(`Failed to fill field ${field.fieldType}:`, error);
      }
    }

    console.log('Form filling completed');
  }

  buildFillPreview(fields: DetectedField[], profile: UserProfile): FillPreviewItem[] {
    const educationIndexes: Partial<Record<FieldType, number>> = {};
    const experienceIndexes: Partial<Record<FieldType, number>> = {};
    const projectIndexes: Partial<Record<FieldType, number>> = {};
    return fields.flatMap(field => {
      const fieldType = field.fieldType as FieldType;
      const value = this.getValueForField(
        fieldType,
        profile,
        this.getEducationIndexForField(field, profile, educationIndexes),
        this.getNextExperienceIndex(fieldType, experienceIndexes),
        this.getNextProjectIndex(fieldType, projectIndexes),
      );
      if (!value) return [];
      const element = field.element;
      const label = element.getAttribute('aria-label')
        || element.getAttribute('placeholder')
        || element.getAttribute('name')
        || element.id
        || fieldType;
      return [{ fieldType, label: label.trim(), value: this.adaptValueForElement(element, value) }];
    });
  }

  private async fillDateRangeFields(
    fields: DetectedField[],
    profile: UserProfile,
    learnedValues: Record<string, LearnedFieldValue>,
  ): Promise<Set<Element>> {
    const handledElements = new Set<Element>();
    const rangeFields = fields.filter(field => this.isDateRangeField(field.fieldType as FieldType));
    const groups = new Map<HTMLElement, DetectedField[]>();

    for (const field of rangeFields) {
      const container = field.element.closest<HTMLElement>(
        '[data-form-field-id="start_end_time"], [data-form-field-name="start_end_time"], [data-form-field-i18n-name="起止时间"]'
      );
      if (!container) continue;

      groups.set(container, [...(groups.get(container) || []), field]);
    }

    const sectionIndexes: Partial<Record<FillSection, number>> = {};
    const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    for (const [container, groupFields] of orderedGroups) {
      const section = this.getSectionForElement(container);
      if (section !== 'education' && section !== 'experience') continue;

      const index = sectionIndexes[section] ?? 0;
      sectionIndexes[section] = index + 1;

      const source = section === 'education'
        ? profile.education[this.resolveEducationIndexForElement(container, profile, index)]
        : profile.experience[index];
      if (!source) continue;

      const dates = this.getOrderedDateRange(source.startDate, source.endDate);
      const inputs = groupFields
        .map(field => field.element)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

      const startInput = inputs[0];
      const endInput = inputs[1];

      // 字节日期范围组件会校验“开始时间不能晚于结束时间”。
      // 先写右侧较晚时间，再写左侧较早时间，避免旧值触发校验回滚。
      if (endInput && dates.end) {
        const value = this.getLearnedValue(learnedValues[this.getFieldSignature(endInput)], profile) || dates.end;
        if (await this.fillField(endInput, value)) handledElements.add(endInput);
        else this.recordFailure(endInput, value, groupFields.find(field => field.element === endInput)?.fieldType || 'endDate');
      }
      if (startInput && dates.start) {
        const value = this.getLearnedValue(learnedValues[this.getFieldSignature(startInput)], profile) || dates.start;
        if (await this.fillField(startInput, value)) handledElements.add(startInput);
        else this.recordFailure(startInput, value, groupFields.find(field => field.element === startInput)?.fieldType || 'startDate');
      }
    }
    return handledElements;
  }

  private recordFailure(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    attemptedValue: string,
    fieldType: string,
    labelOverride = '',
  ): void {
    const root = element.getRootNode() as Document | ShadowRoot;
    const label = labelOverride
      || (isChoiceControl(element) ? getChoiceQuestion(element) : '')
      || element.getAttribute('aria-label')
      || (element.id ? root.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : '')
      || element.closest('label')?.textContent
      || element.getAttribute('placeholder')
      || element.name
      || fieldType;
    this.failures.set(element, {
      element,
      signature: this.getFieldSignature(element),
      fieldType,
      label: (label || fieldType).replace(/\s+/g, ' ').trim().slice(0, 160),
      attemptedValue,
    });
  }

  private isRadioGroupSatisfied(element: HTMLInputElement): boolean {
    if (!element.name) return element.checked;
    const root = element.getRootNode() as Document | ShadowRoot;
    return Array.from(root.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(element.name)}"]`
    )).some(choice => choice.checked);
  }

  private isDateRangeField(fieldType: FieldType): boolean {
    return [
      FieldType.EDUCATION_START_DATE,
      FieldType.GRADUATION_DATE,
      FieldType.START_DATE,
      FieldType.END_DATE,
    ].includes(fieldType);
  }

  private getSectionForElement(element: Element): FillSection | null {
    let current: Element | null = element;

    while (current && current !== document.body) {
      const text = (current.textContent || '').replace(/\s+/g, ' ');
      if (/教育经历|学历类型|学校名称|学院|导师|education|university|degree/i.test(text)) return 'education';
      if (/实习经历|没有实习经历|公司名称|职位名称|work experience|employment|employer/i.test(text)) return 'experience';
      if (/项目经历|项目名称|项目角色|project experience|projects/i.test(text)) return 'projects';
      if (/基本信息|手机号码|个人证件|personal information|contact information/i.test(text)) return 'personal';
      current = current.parentElement;
    }

    return null;
  }

  private async ensureEducationRows(targetCount: number): Promise<boolean> {
    if (targetCount <= 1) return false;

    return this.ensureRows({
      moduleKeyword: '教育经历',
      rowFieldName: ['school', 'school_name', 'university'],
      targetCount,
    });
  }

  private async ensureExperienceRows(targetCount: number): Promise<boolean> {
    if (targetCount === 0) return false;
    let changed = false;

    const internshipModule = this.findModule('实习经历');
    const noExperienceCheckbox = internshipModule
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const noExperienceSelected = noExperienceCheckbox?.checked
      || noExperienceCheckbox?.getAttribute('aria-checked') === 'true';

    if (noExperienceCheckbox && noExperienceSelected) {
      noExperienceCheckbox.click();
      changed = true;
      await this.waitFor(
        () => !noExperienceCheckbox.checked && noExperienceCheckbox.getAttribute('aria-checked') !== 'true',
        600,
      );
    }

    return await this.ensureRows({
      moduleKeyword: '实习经历',
      rowFieldName: ['company', 'company_name', 'employer'],
      targetCount,
    }) || changed;
  }

  private async ensureProjectRows(targetCount: number): Promise<boolean> {
    if (targetCount <= 1) return false;
    return this.ensureRows({
      moduleKeyword: '项目经历',
      rowFieldName: ['name', 'project_name', 'projectName'],
      targetCount,
    });
  }

  private async ensureRows(options: {
    moduleKeyword: string;
    rowFieldName: string | string[];
    targetCount: number;
  }): Promise<boolean> {
    let changed = false;
    for (let attempts = 0; attempts < options.targetCount + 3; attempts++) {
      const currentCount = this.countFieldsInModule(options.moduleKeyword, options.rowFieldName);
      if (currentCount >= options.targetCount) return changed;

      const addButton = this.findAddButton(options.moduleKeyword);
      if (!addButton) return changed;

      addButton.click();
      changed = true;
      await this.waitFor(
        () => this.countFieldsInModule(options.moduleKeyword, options.rowFieldName) > currentCount,
        1200,
      );
    }
    return changed;
  }

  private findModule(keyword: string): HTMLElement | null {
    const aliases: Record<string, string[]> = {
      教育经历: ['教育经历', '教育背景', 'Education'],
      实习经历: ['实习经历', '工作经历', 'Work Experience', 'Employment', 'Experience'],
      项目经历: ['项目经历', 'Projects', 'Project Experience'],
    };
    const terms = aliases[keyword] || [keyword];
    const modules = Array.from(document.querySelectorAll<HTMLElement>(
      '[class*=applyFormModuleWrapper], section, fieldset, [role="group"]'
    ));

    return modules
      .filter(module => terms.some(term => (module.textContent || '').toLowerCase().includes(term.toLowerCase())))
      .sort((a, b) => b.querySelectorAll('input, textarea, select, button').length - a.querySelectorAll('input, textarea, select, button').length)[0] || null;
  }

  private countFieldsInModule(moduleKeyword: string, fieldName: string | string[]): number {
    const module = this.findModule(moduleKeyword);
    if (!module) return 0;
    const fieldNames = new Set(Array.isArray(fieldName) ? fieldName : [fieldName]);

    return Array.from(module.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]), textarea, select'
    )).filter(element => {
      const container = element.closest<HTMLElement>(
        '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]'
      );
      return (
        fieldNames.has(element.getAttribute('data-form-field-name') || '') ||
        fieldNames.has(element.getAttribute('data-form-field-id') || '') ||
        fieldNames.has(element.name) ||
        fieldNames.has(container?.getAttribute('data-form-field-name') || '') ||
        fieldNames.has(container?.getAttribute('data-form-field-id') || '')
      );
    }).length;
  }

  private findAddButton(moduleKeyword: string): HTMLButtonElement | null {
    const module = this.findModule(moduleKeyword);
    if (!module) return null;

    return Array.from(module.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => /^(添加|新增|add|add another|new)$/i.test((button.textContent || '').trim()) && !button.disabled) || null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate()) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(result);
      };
      const observer = new MutationObserver(() => {
        if (predicate()) finish(true);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-expanded', 'aria-selected', 'value'],
      });
      const timer = window.setTimeout(() => finish(predicate()), timeoutMs);
    });
  }

  private getNextEducationIndex(
    fieldType: FieldType,
    educationIndexes: Partial<Record<FieldType, number>>
  ): number | undefined {
    if (!EDUCATION_FIELD_TYPES.has(fieldType)) return undefined;

    const index = educationIndexes[fieldType] ?? 0;
    educationIndexes[fieldType] = index + 1;
    return index;
  }

  /**
   * 招聘网站经常固定先放“研究生”再放“本科”，而用户资料的保存顺序未必一致。
   * 字段或所属卡片明确写出学历层次时，优先按层次选中整条教育经历；没有提示才按顺序回退。
   */
  private getEducationIndexForField(
    field: DetectedField,
    profile: UserProfile,
    educationIndexes: Partial<Record<FieldType, number>>,
  ): number | undefined {
    const fieldType = field.fieldType as FieldType;
    const ordinal = this.getNextEducationIndex(fieldType, educationIndexes);
    if (ordinal === undefined) return undefined;
    return this.resolveEducationIndexForElement(field.element, profile, ordinal);
  }

  private resolveEducationIndexForElement(
    element: Element,
    profile: UserProfile,
    fallbackIndex: number,
  ): number {
    const hint = this.getEducationLevelHint(element);
    if (!hint) return fallbackIndex;

    const matches = profile.education
      .map((education, index) => ({ index, level: this.classifyEducationLevel(`${education.degree} ${education.academicDegree || ''}`) }))
      .filter(item => item.level === hint);
    return matches[fallbackIndex]?.index ?? matches[0]?.index ?? fallbackIndex;
  }

  private getEducationLevelHint(element: Element): string | null {
    const identifiers = FieldMatcher.extractIdentifiers(
      element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    );
    const direct = this.classifyEducationLevel(
      `${identifiers.name} ${identifiers.id} ${identifiers.placeholder} ${identifiers.labelText}`,
    );
    if (direct) return direct;

    let current: Element | null = element.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const ownLabels = Array.from(current.children)
        .filter(child => /^(H[1-6]|LEGEND)$/.test(child.tagName) || child.getAttribute('role') === 'heading')
        .map(child => child.textContent || '')
        .join(' ');
      const text = `${current.getAttribute('aria-label') || ''} ${current.getAttribute('data-form-field-name') || ''} ${ownLabels} ${current.textContent || ''}`.slice(0, 1200);
      const level = this.classifyEducationLevel(text);
      if (level) return level;
    }
    return null;
  }

  private classifyEducationLevel(value: string): string | null {
    const text = value.toLowerCase().replace(/\s+/g, ' ');
    const levels = [
      { key: 'phd', pattern: /博士|ph\.?d|doctorate/ },
      { key: 'master', pattern: /硕士|研究生|master|postgraduate|(?:^|[^a-z])graduate(?:[^a-z]|$)/ },
      { key: 'bachelor', pattern: /本科|学士|bachelor|undergraduate/ },
      { key: 'associate', pattern: /大专|专科|associate/ },
      { key: 'highschool', pattern: /高中|中专|high school/ },
    ].filter(item => item.pattern.test(text));
    return levels.length === 1 ? levels[0].key : null;
  }

  private getNextExperienceIndex(
    fieldType: FieldType,
    experienceIndexes: Partial<Record<FieldType, number>>
  ): number | undefined {
    if (!EXPERIENCE_FIELD_TYPES.has(fieldType)) return undefined;

    const index = experienceIndexes[fieldType] ?? 0;
    experienceIndexes[fieldType] = index + 1;
    return index;
  }

  private getNextProjectIndex(
    fieldType: FieldType,
    projectIndexes: Partial<Record<FieldType, number>>,
  ): number | undefined {
    if (!PROJECT_FIELD_TYPES.has(fieldType)) return undefined;
    const index = projectIndexes[fieldType] ?? 0;
    projectIndexes[fieldType] = index + 1;
    return index;
  }

  // 根据字段类型获取对应的值
  private getValueForField(
    fieldType: FieldType,
    profile: UserProfile,
    educationIndex = 0,
    experienceIndex = 0,
    projectIndex = 0,
  ): string | null {
    const education = profile.education[educationIndex];
    const experience = profile.experience[experienceIndex];
    const project = profile.projects[projectIndex];
    const educationDates = this.getOrderedDateRange(education?.startDate, education?.endDate);
    const experienceDates = this.getOrderedDateRange(experience?.startDate, experience?.endDate);

    switch (fieldType) {
      case FieldType.NAME:
        return profile.personal.name || null;

      case FieldType.GENDER:
        return this.normalizeGender(profile.personal.gender);

      case FieldType.BIRTH_DATE:
        return profile.personal.birthDate || null;

      case FieldType.PHONE:
        return profile.personal.phone || null;

      case FieldType.EMAIL:
        return profile.personal.email || null;

      case FieldType.WECHAT:
        return profile.personal.wechat || null;

      case FieldType.ID_CARD:
        return profile.personal.idCard || null;

      case FieldType.SELF_EVALUATION:
        return profile.personal.selfEvaluation || null;

      case FieldType.SCHOOL:
        return education?.school || null;

      case FieldType.COLLEGE:
        return education?.college || this.inferCollege(education?.school, education?.major) || null;

      case FieldType.EDUCATION_TYPE:
        return education?.educationType || '统招全日制';

      case FieldType.MAJOR:
        return education?.major || null;

      case FieldType.MAJOR_CATEGORY:
        return education?.majorCategory || null;

      case FieldType.DEGREE:
        // 保留用户保存的“硕士研究生/本科”等完整层次；下拉框会再按网站选项匹配同义值。
        return education?.degree || null;

      case FieldType.ACADEMIC_DEGREE:
        return education?.academicDegree || this.inferAcademicDegree(education?.degree) || null;

      case FieldType.GPA:
        return education?.gpa || null;

      case FieldType.EDUCATION_START_DATE:
        return educationDates.start || null;

      case FieldType.GRADUATION_DATE:
        return educationDates.end || null;

      case FieldType.COMPANY:
        return experience?.company || null;

      case FieldType.POSITION:
        return experience?.position || null;

      case FieldType.START_DATE:
        return experienceDates.start || null;

      case FieldType.END_DATE:
        return experienceDates.end || null;

      case FieldType.DESCRIPTION:
        return experience?.description || null;

      case FieldType.PROJECT_NAME:
        return project?.name || null;
      case FieldType.PROJECT_ROLE:
        return project?.role || null;
      case FieldType.PROJECT_START_DATE:
        return project?.startDate || null;
      case FieldType.PROJECT_END_DATE:
        return project?.endDate || null;
      case FieldType.PROJECT_DESCRIPTION:
        return project?.description || null;
      case FieldType.PROJECT_ACHIEVEMENTS:
        return project?.achievements || null;
      case FieldType.PROJECT_TECHNOLOGIES:
        return project?.technologies || null;

      case FieldType.SKILLS:
        return profile.skills.join(', ') || null;

      default:
        return null;
    }
  }

  private getOrderedDateRange(
    startDate?: string,
    endDate?: string
  ): { start: string; end: string } {
    if (!startDate || !endDate) {
      return { start: startDate || '', end: endDate || '' };
    }

    const startKey = this.toComparableDate(startDate);
    const endKey = this.toComparableDate(endDate);

    if (startKey && endKey && startKey > endKey) {
      return { start: endDate, end: startDate };
    }

    return { start: startDate, end: endDate };
  }

  private toComparableDate(value: string): string {
    const match = value.match(/(\d{4})\D{0,3}(\d{1,2})?/);
    if (!match) return '';

    const year = match[1];
    const month = (match[2] || '01').padStart(2, '0');
    return `${year}-${month}`;
  }

  private inferCollege(school?: string, major?: string): string {
    if (school === '北京大学' && major === '计算机科学与技术') {
      return '信息科学技术学院';
    }
    if (school === '浙江大学' && major === '软件工程') {
      return '软件学院';
    }
    if (school === '北京市第四中学') {
      return '理科实验班';
    }
    return '';
  }

  private inferAcademicDegree(degree?: string): string {
    if (/博士/.test(degree || '')) return '博士';
    if (/硕士|研究生/.test(degree || '')) return '硕士';
    if (/本科|学士/.test(degree || '')) return '学士';
    return '';
  }

  // 标准化性别值
  private normalizeGender(gender: string): string | null {
    if (!gender) return null;

    const genderLower = gender.toLowerCase();

    // 检查男性
    if (GENDER_OPTIONS.male.some((opt) => opt.toLowerCase() === genderLower)) {
      return '男';
    }

    // 检查女性
    if (GENDER_OPTIONS.female.some((opt) => opt.toLowerCase() === genderLower)) {
      return '女';
    }

    return gender;
  }

  // 填充单个字段
  private async fillField(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): Promise<boolean> {
    if (!element.isConnected || element.disabled) return false;
    this.capturePreviousValue(element);
    const adaptedValue = this.adaptValueForElement(element, value);
    if (element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type)) {
      return this.fillChoiceField(element, adaptedValue);
    }
    if (element.getAttribute('role') === 'combobox'
      || element.closest('.ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, [data-picker]')) {
      return this.fillGenericCombobox(element as HTMLInputElement, adaptedValue);
    }

    // 根据元素类型进行不同的填充
    if (element.tagName === 'SELECT') {
      if (!this.fillSelectField(element as HTMLSelectElement, adaptedValue)) return false;
    } else {
      this.fillInputField(element as HTMLInputElement | HTMLTextAreaElement, adaptedValue);
    }

    if (element.tagName === 'SELECT') {
      const select = element as HTMLSelectElement;
      const selectedOption = select.options[select.selectedIndex];
      return select.selectedIndex >= 0
        && Boolean(selectedOption)
        && (dropdownValueMatches(selectedOption.text, adaptedValue)
          || dropdownValueMatches(selectedOption.value, adaptedValue))
        && select.checkValidity()
        && select.getAttribute('aria-invalid') !== 'true';
    }
    return (element.value === adaptedValue || areEquivalentDates(element.value, adaptedValue))
      && element.checkValidity()
      && element.getAttribute('aria-invalid') !== 'true';
  }

  private capturePreviousValue(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ): void {
    if (this.previousValues.has(element)) return;
    this.previousValues.set(element, {
      value: this.readElementValue(element),
      checked: element instanceof HTMLInputElement ? element.checked : undefined,
      selectedIndex: element instanceof HTMLSelectElement ? element.selectedIndex : undefined,
    });
  }

  private readElementValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
    if (isChoiceControl(element)) return getLogicalControlValue(element);
    if (element instanceof HTMLSelectElement) {
      return element.options[element.selectedIndex]?.text?.trim() || element.value;
    }
    if (element instanceof HTMLInputElement && element.getAttribute('role') === 'combobox') {
      const trigger = element.closest<HTMLElement>(
        '.ud__select__selector, [role="combobox"], .ant-select, .el-select, .MuiAutocomplete-root, .react-select__control, .semi-select, .arco-select, [class*="cascader" i]'
      ) || element;
      return this.readComboboxDisplayValue(element, trigger);
    }
    return element.value;
  }

  private adaptValueForElement(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string,
  ): string {
    const picker = element.closest<HTMLElement>('[picker], [data-picker]');
    const pickerType = picker?.getAttribute('picker') || picker?.getAttribute('data-picker') || '';
    return adaptDateValue(value, {
      inputType: pickerType === 'month'
        ? 'month'
        : pickerType === 'date'
          ? 'date'
          : element instanceof HTMLInputElement ? element.type : undefined,
      placeholder: element.getAttribute('placeholder') || '',
      pattern: element.getAttribute('pattern') || '',
      options: element instanceof HTMLSelectElement
        ? Array.from(element.options).map(option => option.text)
        : undefined,
    });
  }

  private fillChoiceField(element: HTMLInputElement, value: string): boolean {
    const choices = getChoiceGroup(element);
    const desired = normalizeComparable(value);
    if (!desired) return false;
    const yes = new Set(['true', 'yes', '1', '是', '同意', '接受', '已勾选']);
    const no = new Set(['false', 'no', '0', '否', '不同意', '不接受', '未勾选']);

    if (element.type === 'checkbox' && choices.length === 1 && (yes.has(desired) || no.has(desired))) {
      const shouldCheck = yes.has(desired);
      if (element.checked !== shouldCheck) {
        element.click();
        if (element.checked !== shouldCheck) {
          element.checked = shouldCheck;
          this.triggerEvents(element);
        }
      }
      return element.checked === shouldCheck;
    }

    const desiredParts = value.split(/[,，、/|;；\n]+/).map(normalizeComparable).filter(Boolean);
    const matches = (choice: HTMLInputElement): boolean => {
      return desiredParts.some(part => doesChoiceMatch(choice.value, getChoiceLabel(choice), part));
    };
    const targets = choices.filter(matches);
    if (!targets.length) return false;

    if (element.type === 'radio') {
      const target = targets[0];
      this.capturePreviousValue(target);
      if (!target.checked) target.click();
      if (!target.checked) {
        target.checked = true;
        this.triggerEvents(target);
      }
      return target.checked;
    }

    let changed = false;
    for (const choice of choices) {
      const shouldCheck = targets.includes(choice);
      if (choice.checked === shouldCheck) continue;
      this.capturePreviousValue(choice);
      choice.click();
      if (choice.checked !== shouldCheck) {
        choice.checked = shouldCheck;
        this.triggerEvents(choice);
      }
      changed = true;
    }
    return changed || targets.every(choice => choice.checked);
  }

  private async fillGenericCombobox(element: HTMLInputElement, value: string): Promise<boolean> {
    const trigger = element.closest<HTMLElement>(
      '.ud__select__selector, [role="combobox"], .ant-select, .el-select, .MuiAutocomplete-root, .react-select__control, .ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, [data-picker]'
    ) || element;
    const isMultiple = Boolean(element.getAttribute('aria-multiselectable') === 'true'
      || trigger.getAttribute('aria-multiselectable') === 'true'
      || trigger.closest('.ant-select-multiple, .el-select--multiple, [class*="is-multiple"], [data-multiple="true"]'));
    const isCascader = Boolean(trigger.closest(
      '.ant-cascader, .el-cascader, .arco-cascader, .semi-cascader, [class*="cascader" i]'
    ));
    const requestedValues = isMultiple
      ? splitMultiDropdownValue(value)
      : isCascader ? splitCascaderValue(value) : [value];

    for (const requestedValue of requestedValues) {
      if (!await this.selectComboboxOption(element, trigger, requestedValue)) return false;
    }

    const selected = this.readComboboxDisplayValue(element, trigger);
    if (isMultiple || isCascader) {
      return requestedValues.every(requested => (
        dropdownValueMatches(selected, requested)
        || normalizeDropdownText(selected).includes(normalizeDropdownText(requested))
      ));
    }
    return dropdownValueMatches(selected, value)
      || requestedValues.some(requested => dropdownValueMatches(selected, requested));
  }

  private async selectComboboxOption(
    element: HTMLInputElement,
    trigger: HTMLElement,
    value: string,
  ): Promise<boolean> {
    const visibleBeforeOpen = new Set(this.getAllVisibleDropdownOptions(element));
    trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus();

    const expanded = element.getAttribute('aria-expanded') === 'true'
      || trigger.getAttribute('aria-expanded') === 'true';
    if (!expanded || this.collectDropdownCandidates(element, visibleBeforeOpen).length === 0) {
      trigger.click();
    }

    await this.waitFor(
      () => this.collectDropdownCandidates(element, visibleBeforeOpen).length > 0,
      550,
    );
    let candidates = this.collectDropdownCandidates(element, visibleBeforeOpen);
    let target = this.findDropdownCandidate(value, candidates);

    if (!target && this.isSearchableCombobox(element, trigger)) {
      this.setComboboxSearchValue(element, value);
      await this.waitFor(() => {
        candidates = this.collectDropdownCandidates(element, visibleBeforeOpen);
        return Boolean(this.findDropdownCandidate(value, candidates));
      }, 550);
      target = this.findDropdownCandidate(value, candidates);
    }

    if (!target) {
      target = await this.findVirtualizedDropdownCandidate(element, visibleBeforeOpen, value);
    }
    if (!target) {
      this.closeDropdown(element);
      return false;
    }

    const targetText = this.getDropdownOptionText(target);
    this.activateDropdownOption(target);
    let committed = await this.waitFor(
      () => this.isDropdownSelectionCommitted(element, trigger, target, targetText, value),
      450,
    );
    if (!committed && target.closest('.ud__select__dropdown')) {
      this.activateReactOptionFallback(target);
      committed = await this.waitFor(
        () => this.isDropdownSelectionCommitted(element, trigger, target, targetText, value),
        250,
      );
    }
    return committed || this.isDropdownSelectionCommitted(element, trigger, target, targetText, value);
  }

  private collectDropdownCandidates(
    element: HTMLInputElement,
    visibleBeforeOpen: Set<HTMLElement>,
  ): HTMLElement[] {
    const root = element.getRootNode() as Document | ShadowRoot;
    const controlledId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
    const controlled = controlledId ? root.getElementById(controlledId) : null;
    if (controlled) {
      const controlledOptions = this.getVisibleOptionsWithin(controlled);
      if (controlledOptions.length > 0) return controlledOptions;
    }

    const popupSelector = [
      '[role="listbox"]', '[role="tree"]',
      '.ud__select__dropdown:not(.ud__select__dropdown-hidden)',
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.ant-cascader-menus', '.el-select-dropdown', '.el-cascader__dropdown',
      '.MuiAutocomplete-popper', '.react-select__menu', '.semi-select-dropdown',
      '.arco-select-popup', '.arco-cascader-popup',
    ].join(',');
    const popups = Array.from(root.querySelectorAll<HTMLElement>(popupSelector))
      .filter(popup => this.isElementVisible(popup));
    const popupOptions = popups.reverse().map(popup => this.getVisibleOptionsWithin(popup));
    for (const options of popupOptions) {
      const newlyVisible = options.filter(option => !visibleBeforeOpen.has(option));
      if (newlyVisible.length > 0) return newlyVisible;
    }
    for (const options of popupOptions) {
      if (options.length > 0) return options;
    }

    // Some home-grown widgets append bare role=option nodes without a listbox.
    // Only accept nodes that became visible after opening the current control.
    return this.getAllVisibleDropdownOptions(element)
      .filter(option => !visibleBeforeOpen.has(option));
  }

  private getAllVisibleDropdownOptions(element: HTMLInputElement): HTMLElement[] {
    const root = element.getRootNode() as Document | ShadowRoot;
    return Array.from(root.querySelectorAll<HTMLElement>([
      '[role="option"]', '[role="treeitem"]',
      '.ud__select__list__item', '.ant-select-item-option',
      '.ant-cascader-menu-item', '.el-select-dropdown__item', '.el-cascader-node',
      '.MuiAutocomplete-option', '.react-select__option', '.semi-select-option',
      '.arco-select-option', '.arco-cascader-option',
    ].join(','))).filter(option => (
      this.isElementVisible(option)
      && option.getAttribute('aria-disabled') !== 'true'
      && !option.matches('[disabled], .is-disabled, .ant-select-item-option-disabled')
    ));
  }

  private getVisibleOptionsWithin(container: Element): HTMLElement[] {
    const selector = [
      '[role="option"]', '[role="treeitem"]',
      '.ud__select__list__item', '.ant-select-item-option',
      '.ant-cascader-menu-item', '.el-select-dropdown__item', '.el-cascader-node',
      '.MuiAutocomplete-option', '.react-select__option', '.semi-select-option',
      '.arco-select-option', '.arco-cascader-option',
    ].join(',');
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(option => (
      this.isElementVisible(option)
      && option.getAttribute('aria-disabled') !== 'true'
      && !option.matches('[disabled], .is-disabled, .ant-select-item-option-disabled')
    ));
  }

  private isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && rect.width > 0
      && rect.height > 0;
  }

  private getDropdownOptionText(option: HTMLElement): string {
    return (option.getAttribute('aria-label')
      || option.getAttribute('title')
      || option.textContent
      || '').replace(/\s+/g, ' ').trim();
  }

  private findDropdownCandidate(value: string, candidates: HTMLElement[]): HTMLElement | null {
    const texts = candidates.map(candidate => this.getDropdownOptionText(candidate));
    const dateIndex = findDateOptionIndex(value, texts);
    const index = dateIndex >= 0 ? dateIndex : findBestDropdownOptionIndex(value, texts);
    return index >= 0 ? candidates[index] : null;
  }

  private isSearchableCombobox(element: HTMLInputElement, trigger: HTMLElement): boolean {
    if (element.readOnly || element.disabled) return false;
    if (trigger.closest('.ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, [data-picker]')) {
      return false;
    }
    return ['list', 'both'].includes(element.getAttribute('aria-autocomplete') || '')
      || Boolean(trigger.closest(
        '.ant-select-show-search, .el-select, .MuiAutocomplete-root, .react-select__control, .semi-select, .arco-select'
      ));
  }

  private setComboboxSearchValue(element: HTMLInputElement, value: string): void {
    const oldValue = element.value;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    (element as HTMLInputElement & {
      _valueTracker?: { setValue: (trackedValue: string) => void };
    })._valueTracker?.setValue(oldValue);
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: value,
    }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  private async findVirtualizedDropdownCandidate(
    element: HTMLInputElement,
    visibleBeforeOpen: Set<HTMLElement>,
    value: string,
  ): Promise<HTMLElement | null> {
    let candidates = this.collectDropdownCandidates(element, visibleBeforeOpen);
    const first = candidates[0];
    const scrollContainer = first?.closest<HTMLElement>(
      '.rc-virtual-list-holder, .el-scrollbar__wrap, .ant-select-dropdown, [role="listbox"], [role="tree"]'
    );
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) return null;

    const originalScrollTop = scrollContainer.scrollTop;
    for (let attempt = 0; attempt < 10; attempt++) {
      const nextTop = Math.min(
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
        scrollContainer.scrollTop + Math.max(80, scrollContainer.clientHeight * 0.8),
      );
      if (nextTop <= scrollContainer.scrollTop) break;
      scrollContainer.scrollTop = nextTop;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
      await this.wait(35);
      candidates = this.collectDropdownCandidates(element, visibleBeforeOpen);
      const target = this.findDropdownCandidate(value, candidates);
      if (target) return target;
    }
    scrollContainer.scrollTop = originalScrollTop;
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    return null;
  }

  private activateDropdownOption(target: HTMLElement): void {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
  }

  // Older ByteDance components occasionally ignore synthetic DOM clicks and keep
  // the actual handler on a React private prop. Invoke it only after read-back has
  // proved the normal click did not commit, avoiding a duplicate toggle.
  private activateReactOptionFallback(target: HTMLElement): void {
    const reactKey = Object.keys(target).find(
      key => key.startsWith('__reactEventHandlers$') || key.startsWith('__reactProps$')
    );
    const handlers = reactKey ? (target as any)[reactKey] : null;
    if (typeof handlers?.onClick !== 'function') return;
    handlers.onClick({
      target,
      currentTarget: target,
      type: 'click',
      nativeEvent: new MouseEvent('click'),
      bubbles: true,
      cancelable: true,
      preventDefault: () => {},
      stopPropagation: () => {},
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
      persist: () => {},
    });
  }

  private readComboboxDisplayValue(element: HTMLInputElement, trigger: HTMLElement): string {
    const container = trigger.closest<HTMLElement>(
      '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name], .ud__select, .ant-select, .el-select, .MuiAutocomplete-root, .react-select__control, .semi-select, .arco-select, [class*="cascader" i]'
    ) || trigger;
    const displayed = Array.from(container.querySelectorAll<HTMLElement>([
      '.ud__select__selector__selectItem', '.ant-select-selection-item',
      '.ant-select-selection-item-content', '.el-select__selected-item',
      '.el-tag__content', '.MuiAutocomplete-tag .MuiChip-label',
      '.react-select__multi-value__label', '.semi-select-selection-text',
      '.arco-select-view-value', '[aria-selected="true"]',
    ].join(','))).map(item => (item.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return Array.from(new Set(displayed)).join('、') || element.value.trim();
  }

  private isDropdownSelectionCommitted(
    element: HTMLInputElement,
    trigger: HTMLElement,
    target: HTMLElement,
    targetText: string,
    requestedValue: string,
  ): boolean {
    const selected = this.readComboboxDisplayValue(element, trigger);
    return target.getAttribute('aria-selected') === 'true'
      || target.matches('.is-selected, .ant-select-item-option-selected')
      || dropdownValueMatches(selected, targetText)
      || dropdownValueMatches(selected, requestedValue);
  }

  private closeDropdown(element: HTMLInputElement): void {
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
  }

  // 填充下拉框
  private fillSelectField(element: HTMLSelectElement, value: string): boolean {
    const optionTexts = Array.from(element.options).map(option => option.text.trim());
    const optionValues = Array.from(element.options).map(option => option.value.trim());
    const dateIndex = findDateOptionIndex(value, optionTexts);
    const dateValueIndex = dateIndex >= 0 ? dateIndex : findDateOptionIndex(value, optionValues);
    const textIndex = findBestDropdownOptionIndex(value, optionTexts);
    const valueIndex = findBestDropdownOptionIndex(value, optionValues);
    const selectedIndex = dateValueIndex >= 0
      ? dateValueIndex
      : textIndex >= 0 ? textIndex : valueIndex;
    if (selectedIndex < 0 || element.options[selectedIndex]?.disabled) return false;

    element.selectedIndex = selectedIndex;
    this.triggerEvents(element);
    return true;
  }

  // 填充输入框
  private fillInputField(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ): void {
    const oldValue = element.value;

    // 使用原生 setter 设置值（兼容 React）
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (element.tagName === 'INPUT' && nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else if (element.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    // React 受控输入会用 _valueTracker 判断值是否变化。
    // 先把 tracker 保持为旧值，再触发事件，React 才会接受新值。
    const trackedElement = element as HTMLInputElement & {
      _valueTracker?: { setValue: (value: string) => void };
      [key: string]: any;
    };
    trackedElement._valueTracker?.setValue(oldValue);

    // 触发所有相关事件
    this.triggerEvents(element);
  }

  // 触发表单事件（兼容 React/Vue/Angular）
  private triggerEvents(element: HTMLElement): void {
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    element.dispatchEvent(inputEvent);
    this.triggerReactChange(element, inputEvent);

    const events = [
      new Event('change', { bubbles: true, cancelable: true }),
      new Event('blur', { bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true }),
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true })
    ];

    events.forEach((event) => {
      element.dispatchEvent(event);
    });
  }

  private triggerReactChange(element: HTMLElement, nativeEvent: Event): void {
    const reactKey = Object.keys(element).find(
      key => key.startsWith('__reactEventHandlers$') || key.startsWith('__reactProps$')
    );
    const handlers = reactKey ? (element as any)[reactKey] : null;

    if (typeof handlers?.onChange !== 'function') return;

    handlers.onChange({
      target: element,
      currentTarget: element,
      type: 'change',
      nativeEvent,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
      persist: () => {},
    });
  }

  // 上传简历文件
  async uploadResume(
    fileInput: HTMLInputElement,
    fileData: string,
    fileName: string
  ): Promise<void> {
    try {
      // 将 base64 转换为 Blob
      const blob = this.base64ToBlob(fileData);

      // 创建 File 对象
      const file = new File([blob], fileName, { type: blob.type });

      // 创建 DataTransfer 对象
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // 设置文件
      fileInput.files = dataTransfer.files;

      // 触发 change 事件
      this.triggerEvents(fileInput);

      console.log(`Resume uploaded: ${fileName}`);
    } catch (error) {
      console.error('Failed to upload resume:', error);
      throw error;
    }
  }

  // 将 base64 转换为 Blob
  private base64ToBlob(base64Data: string): Blob {
    // 提取 MIME 类型和数据
    const parts = base64Data.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const base64String = parts[1] || parts[0];

    // 解码 base64
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
  }
}

function readProfilePath(profile: UserProfile, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = profile;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
