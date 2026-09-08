import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProfileForResume,
  createResumeProfileSnapshot,
  createResumeVariant,
  getResumeLibrary,
  LEGACY_RESUME_ID,
  normalizeResumeLibrary,
  resolveResumeSelection,
} from './resumes.ts';

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

test('每份简历保留独立解析资料并按选择切换填写内容', () => {
  const productProfile = createResumeProfileSnapshot({
    rawText: '产品版',
    personal: { name: '张三', email: 'product@example.com' },
    education: [],
    experience: [{ company: '甲公司', position: '产品经理' }],
    projects: [],
    skills: ['原型设计'],
  });
  const operationProfile = createResumeProfileSnapshot({
    rawText: '运营版',
    personal: { name: '张三' },
    education: [],
    experience: [{ company: '乙公司', position: '内容运营' }],
    projects: [],
    skills: ['用户增长'],
  });
  const profile = {
    personal: { name: '默认姓名', email: 'base@example.com' },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resumes: [
      createResumeVariant(legacyResume, { id: 'pm', category: '产品岗', parsedProfile: productProfile }),
      createResumeVariant({ ...legacyResume, fileName: '运营版.pdf' }, { id: 'ops', category: '运营岗', parsedProfile: operationProfile }),
    ],
  } as any;

  const product = buildProfileForResume(profile, 'pm');
  const operation = buildProfileForResume(profile, 'ops');
  assert.equal(product.experience[0]?.position, '产品经理');
  assert.equal(product.personal.email, 'product@example.com');
  assert.equal(operation.experience[0]?.position, '内容运营');
  assert.equal(operation.personal.email, 'base@example.com');
  assert.deepEqual(operation.skills, ['用户增长']);
});

test('旧简历没有独立资料时继续使用全局资料', () => {
  const profile = {
    personal: { name: '旧版用户' },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resume: legacyResume,
  } as any;
  assert.equal(buildProfileForResume(profile, LEGACY_RESUME_ID).personal.name, '旧版用户');
});

test('旧简历的硕士字段迁移为独立的学历层次和学位', () => {
  const resumes = normalizeResumeLibrary({
    resumes: [{
      ...legacyResume,
      id: 'old-master',
      category: '默认简历',
      parsedProfile: {
        personal: {},
        education: [{ id: 'edu-1', school: '新疆大学', major: '能源动力', degree: '硕士', startDate: '', endDate: '' }],
        experience: [],
        projects: [],
        skills: [],
      },
    }],
  });
  assert.equal(resumes[0]?.parsedProfile?.education[0]?.degree, '硕士研究生');
  assert.equal(resumes[0]?.parsedProfile?.education[0]?.academicDegree, '硕士');
});

test('简历解析缺少学院时按学校和学历层次使用手动资料补全', () => {
  const profile = {
    personal: { name: '张三' },
    education: [
      { id: 'base-undergraduate', school: '山东科技大学', college: '智能装备学院', major: '过程装备与控制工程', majorCategory: '机械类', degree: '本科', academicDegree: '工学学士', startDate: '', endDate: '' },
      { id: 'base-master', school: '新疆大学', college: '电气工程学院', major: '能源动力', majorCategory: '动力工程及工程热物理', degree: '硕士研究生', academicDegree: '工程硕士', startDate: '', endDate: '' },
    ],
    experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resumes: [{
      ...legacyResume,
      id: 'target',
      category: '目标岗位',
      parsedProfile: {
        personal: {},
        education: [
          { id: 'resume-master', school: '新疆大学', college: '', major: '能源动力', degree: '硕士研究生', startDate: '', endDate: '' },
          { id: 'resume-undergraduate', school: '山东科技大学', college: '', major: '过程装备与控制工程', degree: '本科', startDate: '', endDate: '' },
        ],
        experience: [], projects: [], skills: [],
      },
    }],
  } as any;
  const selected = buildProfileForResume(profile, 'target');
  assert.equal(selected.education[0]?.college, '电气工程学院');
  assert.equal(selected.education[0]?.majorCategory, '动力工程及工程热物理');
  assert.equal(selected.education[1]?.college, '智能装备学院');
  assert.equal(selected.education[1]?.academicDegree, '工学学士');
});
