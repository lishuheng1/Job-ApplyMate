import type { DetectedField } from '../shared/types';
import { FieldType } from '../shared/types';
import { FieldMatcher } from '../utils/fieldMatcher';
import {
  getChoiceGroup,
  getChoiceQuestion,
  getControlOptions,
  isChoiceControl,
  isLogicalChoiceRepresentative,
} from './controlSemantics';

export interface UnmatchedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  identifiers: ReturnType<typeof FieldMatcher.extractIdentifiers>;
}

export class FormDetector {
  private observer: MutationObserver | null = null;
  private detectedFields: DetectedField[] = [];
  private unmatchedFields: UnmatchedField[] = [];
  private observedRoots = new WeakSet<Node>();
  private searchRoots: ParentNode[] = [document];
  private discoveredRoots = new WeakSet<Node>();
  private redetectTimer: number | null = null;

  private getSearchRoots(): ParentNode[] {
    this.discoverShadowRoots(document);
    return this.searchRoots;
  }

  private discoverShadowRoots(root: ParentNode): void {
    if (this.discoveredRoots.has(root as Node)) return;
    this.discoveredRoots.add(root as Node);
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (!element.shadowRoot || this.searchRoots.includes(element.shadowRoot)) continue;
      this.searchRoots.push(element.shadowRoot);
      this.discoverShadowRoots(element.shadowRoot);
    }
  }

  // 检测页面中的所有表单字段
  detectFields(): DetectedField[] {
    this.detectedFields = [];
    this.unmatchedFields = [];

    const roots = this.getSearchRoots();
    const controls = roots.flatMap(root => Array.from(root.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')));
    controls.forEach(control => {
      if (isLogicalChoiceRepresentative(control)) this.analyzeElement(control);
    });

    console.log(`Detected ${this.detectedFields.length} form fields, ${this.unmatchedFields.length} unmatched`);
    return this.detectedFields;
  }

  // 分析单个元素
  private analyzeElement(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  ): void {
    if (element instanceof HTMLInputElement && [
      'file', 'password', 'reset', 'image', 'range', 'color',
    ].includes(element.type.toLowerCase())) return;
    const isCombobox = element.getAttribute('role') === 'combobox'
      || Boolean(element.closest('.ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, [data-picker]'));

    const visible = element.getClientRects().length > 0
      || (isChoiceControl(element) && getChoiceGroup(element).some(choice => {
        const label = choice.id
          ? (choice.getRootNode() as Document | ShadowRoot)
            .querySelector(`label[for="${CSS.escape(choice.id)}"]`)
          : choice.closest('label');
        return Boolean(label && (label as HTMLElement).getClientRects().length > 0);
      }));
    if (
      !visible ||
      element.disabled ||
      ('readOnly' in element && element.readOnly && !isCombobox)
    ) {
      return;
    }

    // 提取元素标识符
    const identifiers = FieldMatcher.extractIdentifiers(element);
    if (isChoiceControl(element)) {
      const question = getChoiceQuestion(element);
      identifiers.labelText = question || identifiers.labelText;
      identifiers.contextText = `${identifiers.contextText} ${question} 选项 ${getControlOptions(element).join(' / ')}`.trim();
    }

    // 匹配字段类型
    const { fieldType, confidence } = FieldMatcher.matchFieldType(
      identifiers.name,
      identifiers.id,
      identifiers.placeholder,
      identifiers.labelText,
      identifiers.type,
      identifiers.autocomplete,
      identifiers.contextText,
    );

    if (confidence >= 0.5 && fieldType !== FieldType.UNKNOWN) {
      this.detectedFields.push({
        element,
        fieldType,
        confidence,
        value: element.value
      });
    } else {
      this.unmatchedFields.push({ element, identifiers });
    }
  }

  // 开始监听DOM变化
  startObserving(callback: (fields: DetectedField[]) => void): void {
    if (this.observer) {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      let shouldRedetect = false;

      for (const mutation of mutations) {
        // 检查是否添加了新的表单元素
        if (mutation.addedNodes.length > 0) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.shadowRoot) {
                if (!this.searchRoots.includes(element.shadowRoot)) this.searchRoots.push(element.shadowRoot);
                this.discoverShadowRoots(element.shadowRoot);
              }
              this.discoverShadowRoots(element);
              if (
                element.tagName === 'INPUT' ||
                element.tagName === 'TEXTAREA' ||
                element.tagName === 'SELECT' ||
                element.querySelector('input, textarea, select')
              ) {
                shouldRedetect = true;
                break;
              }
            }
          }
        }

        if (shouldRedetect) break;
      }

      if (shouldRedetect) {
        if (this.redetectTimer !== null) window.clearTimeout(this.redetectTimer);
        this.redetectTimer = window.setTimeout(() => {
          this.redetectTimer = null;
          const fields = this.detectFields();
          this.observeShadowRoots();
          callback(fields);
        }, 80);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    this.observedRoots.add(document.body);
    this.observeShadowRoots();

    console.log('Started observing DOM changes');
  }

  // 停止监听
  stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      this.observedRoots = new WeakSet<Node>();
      if (this.redetectTimer !== null) window.clearTimeout(this.redetectTimer);
      this.redetectTimer = null;
      console.log('Stopped observing DOM changes');
    }
  }

  // 获取已检测的字段
  getDetectedFields(): DetectedField[] {
    return this.detectedFields;
  }

  // 获取未匹配的字段（供 LLM 语义匹配使用）
  getUnmatchedFields(): UnmatchedField[] {
    return this.unmatchedFields;
  }

  // 根据字段类型查找元素
  findFieldsByType(fieldType: FieldType): DetectedField[] {
    return this.detectedFields.filter((field) => field.fieldType === fieldType);
  }

  // 查找文件上传控件
  findFileInputs(): HTMLInputElement[] {
    const fileInputs = this.getSearchRoots().flatMap(root => Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="file"]')
    ));

    return Array.from(fileInputs).filter((input) => {
      // 检查是否与简历相关
      const identifiers = FieldMatcher.extractIdentifiers(input);
      const searchText =
        `${identifiers.name} ${identifiers.id} ${identifiers.placeholder} ${identifiers.labelText}`.toLowerCase();

      return /简历|resume|cv|附件|attach/i.test(searchText);
    });
  }

  private observeShadowRoots(): void {
    if (!this.observer) return;
    for (const root of this.getSearchRoots()) {
      if (!(root instanceof ShadowRoot) || this.observedRoots.has(root)) continue;
      this.observer.observe(root, { childList: true, subtree: true });
      this.observedRoots.add(root);
    }
  }
}
