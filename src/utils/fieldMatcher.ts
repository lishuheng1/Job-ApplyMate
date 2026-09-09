import { FIELD_PATTERNS } from '../shared/constants';
import { FieldType } from '../shared/types';

type MatchResult = { fieldType: FieldType; confidence: number };

function normalize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_./\\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function containsPattern(text: string, pattern: string): boolean {
  const value = normalize(pattern);
  if (!value) return false;
  if (/[\u3400-\u9fff]/.test(value)) return text.includes(value);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(text);
}

export class FieldMatcher {
  static matchFieldType(
    name: string, id: string, placeholder: string, labelText: string,
    type: string, autocomplete: string, contextText = '',
  ): MatchResult {
    const primary = normalize(`${name} ${id} ${placeholder} ${labelText} ${autocomplete}`);
    const context = normalize(`${contextText} ${labelText} ${name} ${id}`);
    const htmlType = type.toLowerCase();

    if (htmlType === 'email' || containsPattern(primary, 'email')) return { fieldType: FieldType.EMAIL, confidence: 1 };
    if (htmlType === 'tel' || /(?:^|\s)(?:phone|mobile|tel|telephone|cellphone)(?:$|\s)|手机|电话/.test(primary)) {
      return { fieldType: FieldType.PHONE, confidence: htmlType === 'tel' ? 1 : 0.98 };
    }
    if (htmlType === 'file') return { fieldType: FieldType.RESUME_FILE, confidence: 0.9 };
    if (containsPattern(normalize(autocomplete), 'name')) return { fieldType: FieldType.NAME, confidence: 0.98 };
    if (containsPattern(normalize(autocomplete), 'bday')) return { fieldType: FieldType.BIRTH_DATE, confidence: 0.98 };

    const projectContext = /项目|(?:^|\s)project(?:$|\s)/.test(context);
    const educationContext = /教育|学校|院校|大学|学院|入学|毕业|(?:^|\s)(?:education|school|university|college|academic)(?:$|\s)/.test(context);
    const workContext = /工作|实习|公司|单位|入职|离职|岗位|职位|(?:^|\s)(?:work|job|company|employer|intern|employment)(?:$|\s)/.test(context);
    const isStart = /开始|起始|入学|(?:^|\s)(?:start|from|begin|since|enroll|enrol|admission)(?:$|\s)/.test(primary);
    const isEnd = /结束|终止|毕业|离职|(?:^|\s)(?:end|to|until|finish|graduation)(?:$|\s)/.test(primary);

    if (projectContext) {
      if (/项目名称|(?:^|\s)(?:project\s*name|name)(?:$|\s)/.test(primary)) return { fieldType: FieldType.PROJECT_NAME, confidence: 0.98 };
      if (/项目角色|项目职责|(?:^|\s)(?:project\s*role|role)(?:$|\s)/.test(primary)) return { fieldType: FieldType.PROJECT_ROLE, confidence: 0.98 };
      if (isStart) return { fieldType: FieldType.PROJECT_START_DATE, confidence: 0.96 };
      if (isEnd) return { fieldType: FieldType.PROJECT_END_DATE, confidence: 0.96 };
      if (/项目成果|项目业绩|(?:^|\s)(?:achievement|result|outcome)s?(?:$|\s)/.test(primary)) return { fieldType: FieldType.PROJECT_ACHIEVEMENTS, confidence: 0.96 };
      if (/技术栈|项目技术|(?:^|\s)(?:technologies|technology|tech\s*stack)(?:$|\s)/.test(primary)) return { fieldType: FieldType.PROJECT_TECHNOLOGIES, confidence: 0.96 };
      if (/项目描述|项目内容|(?:^|\s)(?:description|detail|content)(?:$|\s)/.test(primary)) return { fieldType: FieldType.PROJECT_DESCRIPTION, confidence: 0.96 };
    }

    if (/学历类型|学习形式|培养方式|(?:^|\s)(?:education\s*type|study\s*type)(?:$|\s)/.test(primary)) return { fieldType: FieldType.EDUCATION_TYPE, confidence: 1 };
    if (/专业类别|专业大类|学科类别|学科门类|一级学科|所属专业类|(?:^|\s)(?:major\s*category|discipline\s*category)(?:$|\s)/.test(primary)) return { fieldType: FieldType.MAJOR_CATEGORY, confidence: 1 };
    if (/学位名称|授予学位|学位|(?:^|\s)(?:academic\s*degree|degree\s*awarded)(?:$|\s)/.test(primary)) return { fieldType: FieldType.ACADEMIC_DEGREE, confidence: 1 };
    if (/学历层次|教育程度|(?:^|\s)(?:degree\s*level|education\s*level)(?:$|\s)/.test(primary)) return { fieldType: FieldType.DEGREE, confidence: 1 };
    if (/学院|院系|系别|(?:^|\s)(?:college|department|faculty|school\s*of)(?:$|\s)/.test(primary)) return { fieldType: FieldType.COLLEGE, confidence: 0.98 };
    if (/学校|院校|大学|(?:^|\s)(?:school|university|alma)(?:$|\s)/.test(primary)) return { fieldType: FieldType.SCHOOL, confidence: 0.98 };
    if (/政治面貌|政治状态|政治身份|党派|(?:^|\s)(?:political\s*status|political\s*affiliation)(?:$|\s)/.test(primary)) return { fieldType: FieldType.POLITICAL_STATUS, confidence: 1 };
    if (/身份证|证件号|(?:^|\s)(?:id\s*card|identity\s*card|id\s*number)(?:$|\s)/.test(primary)) return { fieldType: FieldType.ID_CARD, confidence: 0.98 };
    if (educationContext && !workContext) {
      if (isEnd) return { fieldType: FieldType.GRADUATION_DATE, confidence: 0.96 };
      if (isStart) return { fieldType: FieldType.EDUCATION_START_DATE, confidence: 0.96 };
    }
    if (workContext && !educationContext && !/地点|地址|location|city/.test(primary)) {
      if (isEnd) return { fieldType: FieldType.END_DATE, confidence: 0.96 };
      if (isStart) return { fieldType: FieldType.START_DATE, confidence: 0.96 };
    }

    let best: MatchResult = { fieldType: FieldType.UNKNOWN, confidence: 0 };
    let tied = false;
    for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
      for (const pattern of patterns) {
        if (!containsPattern(primary, pattern)) continue;
        const confidence = normalize(pattern) === primary ? 0.97 : 0.9;
        if (confidence > best.confidence) {
          best = { fieldType: fieldType as FieldType, confidence };
          tied = false;
        } else if (confidence === best.confidence && fieldType !== best.fieldType) tied = true;
      }
    }
    return tied ? { fieldType: FieldType.UNKNOWN, confidence: 0 } : best;
  }

  static extractIdentifiers(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): {
    name: string; id: string; placeholder: string; labelText: string;
    type: string; autocomplete: string; contextText: string;
  } {
    const container = element.closest<HTMLElement>('[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]');
    const dataNames = [element.getAttribute('data-form-field-name') || '', element.getAttribute('data-form-field-id') || '', container?.getAttribute('data-form-field-name') || '', container?.getAttribute('data-form-field-id') || ''].filter(Boolean);
    const name = [element.getAttribute('name') || '', ...dataNames].filter(Boolean).join(' ');
    const id = [element.id || '', element.getAttribute('data-form-field-id') || '', container?.getAttribute('data-form-field-id') || ''].filter(Boolean).join(' ');
    const placeholder = element.getAttribute('placeholder') || '';
    const type = element.getAttribute('type') || '';
    const autocomplete = element.getAttribute('autocomplete') || '';
    const root = element.getRootNode() as Document | ShadowRoot;
    let labelText = element.id ? (root.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '') : '';
    const labelledBy = element.getAttribute('aria-labelledby');
    labelText ||= labelledBy
      ? labelledBy.split(/\s+/).map(ref => root.getElementById(ref)?.textContent || '').join(' ')
      : '';
    labelText ||= container?.querySelector('.ud-formily-item-label label, .ud-formily-item-label, label')?.textContent || '';
    labelText ||= element.closest('label')?.textContent || '';
    labelText ||= element.getAttribute('aria-label') || '';
    labelText ||= [element.getAttribute('data-form-field-i18n-name') || '', container?.getAttribute('data-form-field-i18n-name') || ''].filter(Boolean).join(' ');
    labelText ||= getNearbyLabelText(element);
    const module = element.closest<HTMLElement>('[class*=applyFormModuleWrapper], section, fieldset, [role=group]');
    const heading = module?.querySelector('h1, h2, h3, h4, legend, [class*=title]')?.textContent || '';
    const localContainer = container || element.closest<HTMLElement>(
      '[class*=formItem], [class*=form-item], [class*=field], [role=group], fieldset',
    );
    const localText = String(localContainer?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const contextText = `${heading} ${module?.getAttribute('aria-label') || ''} ${localText}`.replace(/\s+/g, ' ').trim();
    return {
      name,
      id,
      placeholder,
      labelText: labelText.replace(/\s+/g, ' ').trim().slice(0, 180),
      type,
      autocomplete,
      contextText,
    };
  }
}

function getNearbyLabelText(element: Element): string {
  const usable = (candidate: Element | null): string => {
    if (!candidate || candidate.contains(element) || candidate.querySelector('input, textarea, select')) return '';
    const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length >= 2 && text.length <= 120 && /[\p{L}\p{N}]/u.test(text) ? text : '';
  };

  const sibling = usable(element.previousElementSibling);
  if (sibling) return sibling;
  let current = element.parentElement;
  for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
    const direct = Array.from(current.children)
      .filter(child => !child.contains(element))
      .map(usable)
      .find(Boolean);
    if (direct) return direct;
  }
  return '';
}
