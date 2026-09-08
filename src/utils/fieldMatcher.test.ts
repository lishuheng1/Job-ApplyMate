import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldType } from '../shared/types.ts';
import { FieldMatcher } from './fieldMatcher.ts';

function match(name: string, context = ''): FieldType {
  return FieldMatcher.matchFieldType(name, '', '', '', 'text', '', context).fieldType;
}

test('字段匹配使用词边界，避免通用 id/job/contact 子串误判', () => {
  assert.equal(match('contactEmail'), FieldType.EMAIL);
  assert.equal(match('candidate_id'), FieldType.UNKNOWN);
  assert.equal(match('job_location'), FieldType.UNKNOWN);
  assert.equal(match('valid_from'), FieldType.UNKNOWN);
});

test('学校、学院与学历不再互相覆盖', () => {
  assert.equal(match('college'), FieldType.COLLEGE);
  assert.equal(match('school'), FieldType.SCHOOL);
  assert.equal(match('degree'), FieldType.DEGREE);
});

test('专业类别、学历层次与学位分别识别', () => {
  assert.equal(match('major_category'), FieldType.MAJOR_CATEGORY);
  assert.equal(match('学历层次'), FieldType.DEGREE);
  assert.equal(match('graduate_degree_level'), FieldType.DEGREE);
  assert.equal(match('academic_degree'), FieldType.ACADEMIC_DEGREE);
  assert.equal(match('授予学位'), FieldType.ACADEMIC_DEGREE);
});

test('项目经历字段映射到独立项目类型', () => {
  assert.equal(match('name', '项目经历 project'), FieldType.PROJECT_NAME);
  assert.equal(match('project_role', '项目经历'), FieldType.PROJECT_ROLE);
  assert.equal(match('start_date', '项目经历'), FieldType.PROJECT_START_DATE);
  assert.equal(match('description', '项目经历'), FieldType.PROJECT_DESCRIPTION);
});
