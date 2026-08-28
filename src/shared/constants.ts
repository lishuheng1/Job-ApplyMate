import { FieldType } from './types';

// 字段匹配模式配置
export const FIELD_PATTERNS: Record<string, string[]> = {
  [FieldType.NAME]: [
    'name', '姓名', 'xingming', 'fullname', 'username', 'realname',
    '真实姓名', '申请人姓名', 'applicant', '候选人姓名'
  ],
  [FieldType.GENDER]: [
    'gender', 'sex', '性别', 'xingbie', '男女'
  ],
  [FieldType.BIRTH_DATE]: [
    'birth', 'birthday', 'birthdate', '生日', '出生日期', 'dateofbirth',
    'dob', '出生年月', 'borndate'
  ],
  [FieldType.PHONE]: [
    'phone', 'mobile', 'tel', 'telephone', 'cellphone',
    '电话', '手机', '联系电话', '手机号', '联系方式', 'phonenumber'
  ],
  [FieldType.EMAIL]: [
    'email', 'mail', 'e-mail', '邮箱', '电子邮箱', '邮件', 'emailaddress'
  ],
  [FieldType.WECHAT]: [
    'wechat', 'weixin', 'wx', '微信', '微信号', 'wechatid'
  ],
  [FieldType.ID_CARD]: [
    'idcard', 'identitycard', 'identity', '身份证', '身份证号',
    'idnumber', 'cardnumber', '证件号'
  ],
  [FieldType.SCHOOL]: [
    'school', 'university', '学校', '院校',
    '毕业院校', '就读学校', 'alma'
  ],
  [FieldType.COLLEGE]: [
    'college', 'department', 'faculty', 'schoolof', 'institute',
    '学院', '院系', '所在学院', '所属学院', '系别', '院系名称'
  ],
  [FieldType.EDUCATION_TYPE]: [
    'educationtype', 'education_type', 'studytype', '学历类型',
    '学习形式', '培养方式', '全日制', '非全日制'
  ],
  [FieldType.MAJOR]: [
    'major', 'specialty', 'discipline', 'subject', '专业', '所学专业',
    '专业名称', 'fieldofstudy', 'field_of_study', 'course'
  ],
  [FieldType.DEGREE]: [
    'degree', 'diploma', 'qualification', '学历', '学位',
    '文凭', '教育程度', 'academicqualification'
  ],
  [FieldType.GPA]: [
    'gpa', 'grade', 'score', 'average', '成绩', '绩点', '平均分',
    '学分绩点', 'gradepoint'
  ],
  [FieldType.SELF_EVALUATION]: [
    'selfevaluation', 'self_evaluation', 'selfassessment', 'personalsummary',
    '自我评价', '个人评价', '个人总结', '个人优势', '自我描述'
  ],
  [FieldType.EDUCATION_START_DATE]: [
    '入学时间', '入学日期', '入学年月', '就读开始', '就读起始',
    '教育开始时间', '教育开始日期', 'educationstart', 'educationstartdate',
    'schoolstart', 'schoolstartdate', 'enrollment', 'enrolment', 'admissiondate'
  ],
  [FieldType.GRADUATION_DATE]: [
    'graduation', 'graduate', 'enddate', '毕业时间', '毕业日期',
    '预计毕业', '毕业年月', 'graduationdate', 'expectedgraduation'
  ],
  [FieldType.COMPANY]: [
    'company', 'employer', 'organization', 'firm', 'corporation',
    '公司', '单位', '工作单位', '雇主', 'workplace'
  ],
  [FieldType.POSITION]: [
    'position', 'jobtitle', 'worktitle', 'post', '职位', '岗位',
    '职务', '工作职位', 'jobtitle'
  ],
  [FieldType.START_DATE]: [
    'startdate', '开始时间',
    '起始时间', '开始日期', '入职时间'
  ],
  [FieldType.END_DATE]: [
    'enddate', '结束时间',
    '终止时间', '结束日期', '离职时间'
  ],
  [FieldType.DESCRIPTION]: [
    'description', 'desc', 'detail', 'content',
    '描述', '详情', '工作内容', '职责描述', 'responsibility'
  ],
  [FieldType.PROJECT_NAME]: ['projectname', 'project_name', '项目名称'],
  [FieldType.PROJECT_ROLE]: ['projectrole', 'project_role', '项目角色', '项目职责'],
  [FieldType.PROJECT_START_DATE]: ['projectstart', 'project_start_date', '项目开始时间'],
  [FieldType.PROJECT_END_DATE]: ['projectend', 'project_end_date', '项目结束时间'],
  [FieldType.PROJECT_DESCRIPTION]: ['projectdescription', 'project_description', '项目描述', '项目内容'],
  [FieldType.PROJECT_ACHIEVEMENTS]: ['projectachievements', 'project_achievements', '项目成果', '项目业绩'],
  [FieldType.PROJECT_TECHNOLOGIES]: ['projecttechnologies', 'project_technologies', '技术栈', '项目技术'],
  [FieldType.SKILLS]: [
    'skill', 'skills', 'ability', 'competency', 'expertise',
    '技能', '专业技能', '掌握技能', '能力', 'technical'
  ],
  [FieldType.RESUME_FILE]: [
    'resume', 'cv', 'curriculum', 'attachment', 'file', 'upload',
    '简历', '附件', '上传', '个人简历', 'document'
  ]
};

// 性别选项映射
export const GENDER_OPTIONS: Record<string, string[]> = {
  male: ['男', 'male', 'M', '先生', 'man'],
  female: ['女', 'female', 'F', '女士', 'woman']
};

// 学历选项映射
export const DEGREE_OPTIONS: Record<string, string[]> = {
  highschool: ['高中', '中专', 'High School'],
  associate: ['专科', '大专', 'Associate'],
  bachelor: ['本科', '学士', 'Bachelor', '大学本科'],
  master: ['硕士', '研究生', 'Master', '硕士研究生'],
  phd: ['博士', 'PhD', 'Doctor', 'Doctorate', '博士研究生']
};

// 政治面貌选项
export const POLITICAL_STATUS_OPTIONS = [
  '中共党员',
  '中共预备党员',
  '共青团员',
  '民主党派',
  '群众'
];

// 常用技能标签
export const COMMON_SKILLS = [
  'JavaScript',
  'TypeScript',
  'React',
  'Vue',
  'Angular',
  'Node.js',
  'Python',
  'Java',
  'C++',
  'Go',
  'HTML/CSS',
  'SQL',
  'Git',
  'Docker',
  'Kubernetes'
];

// 扩展名到MIME类型映射
export const MIME_TYPES: Record<string, string> = {
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'txt': 'text/plain',
  'md': 'text/markdown'
};

// 支持的文件格式
export const SUPPORTED_FILE_TYPES = ['pdf', 'doc', 'docx', 'txt', 'md'];

// 最大文件大小 (5MB)
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
