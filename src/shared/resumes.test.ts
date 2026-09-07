import assert from 'node:assert/strict';
import test from 'node:test';
import { createResumeVariant, getResumeLibrary, LEGACY_RESUME_ID, resolveResumeSelection } from './resumes.ts';

const legacyResume = {
  fileName: '产品经理-张三.pdf',
  fileData: 'data:application/pdf;base64,QQ==',
  fileType: 'pdf',
  uploadDate: '2026-09-07T00:00:00.000Z',
};

test('旧版单简历自动迁移为默认分类且保留原文件名', () => {
  const library = getResumeLibrary({ resume: legacyResume });
  assert.equal(library[0]?.id, LEGACY_RESUME_ID);
  assert.equal(library[0]?.category, '默认简历');
  assert.equal(library[0]?.fileName, '产品经理-张三.pdf');
});

test('本次可明确选择不上传或指定简历', () => {
  const profile = {
    resume: legacyResume,
    resumes: [
      { ...legacyResume, id: 'pm', category: '产品岗' },
      { ...legacyResume, id: 'operation', category: '运营岗', fileName: '运营版.pdf' },
    ],
  };
  assert.equal(resolveResumeSelection(profile, null), undefined);
  assert.equal(resolveResumeSelection(profile, 'operation')?.fileName, '运营版.pdf');
  assert.equal(resolveResumeSelection(profile, 'missing'), undefined);
  assert.equal(resolveResumeSelection(profile, undefined)?.fileName, legacyResume.fileName);
});

test('插件分类不会改写简历原文件名', () => {
  const variant = createResumeVariant(legacyResume, { id: 'pm', category: '  产品岗  ' });
  assert.equal(variant.category, '产品岗');
  assert.equal(variant.fileName, '产品经理-张三.pdf');
});
