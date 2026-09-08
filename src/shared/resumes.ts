import type {
  EducationInfo,
  ExperienceInfo,
  ParsedResumeData,
  ProjectInfo,
  ResumeInfo,
  ResumeProfileSnapshot,
  ResumeVariant,
  UserProfile,
} from './types.ts';

export const LEGACY_RESUME_ID = 'legacy-resume';

export function createResumeVariant(
  resume: ResumeInfo,
  options: { id: string; category?: string; parsedProfile?: ResumeProfileSnapshot },
): ResumeVariant {
  return {
    ...resume,
    id: options.id,
    category: options.category?.trim() || '未分类',
    // fileName 始终直接继承浏览器提供的原文件名，不使用分类名改写。
    fileName: resume.fileName,
    ...(options.parsedProfile ? { parsedProfile: options.parsedProfile } : {}),
  };
}

function normalizeEducation(
  value: Partial<EducationInfo>,
  index: number,
): EducationInfo {
  return {
    id: value.id || `resume-edu-${index + 1}`,
    school: value.school || '',
    college: value.college || '',
    educationType: value.educationType || '',
    major: value.major || '',
    majorCategory: value.majorCategory || '',
    degree: normalizeEducationLevel(value.degree),
    academicDegree: value.academicDegree || inferAcademicDegree(value.degree),
    startDate: value.startDate || '',
    endDate: value.endDate || '',
    gpa: value.gpa || '',
    ranking: value.ranking || '',
  };
}

function inferAcademicDegree(degree?: string): string {
  if (/博士/.test(degree || '')) return '博士';
  if (/硕士|研究生/.test(degree || '')) return '硕士';
  if (/本科|学士/.test(degree || '')) return '学士';
  return '';
}

function normalizeEducationLevel(degree?: string): string {
  const value = degree || '';
  if (/博士/.test(value) && !/博士后/.test(value)) return '博士研究生';
  if (/硕士|研究生|MBA|EMBA/i.test(value)) return '硕士研究生';
  if (/本科|学士/.test(value)) return '本科';
  return value;
}

function mergeEducationWithFallback(
  selectedEducation: EducationInfo[],
  fallbackEducation: EducationInfo[],
): EducationInfo[] {
  if (selectedEducation.length === 0) return fallbackEducation;

  return selectedEducation.map((selected, index) => {
    const selectedLevel = normalizeEducationLevel(selected.degree);
    const fallback = fallbackEducation.find(item => (
      Boolean(selected.school && item.school)
      && selected.school.trim().toLowerCase() === item.school.trim().toLowerCase()
    )) || fallbackEducation.find(item => (
      Boolean(selectedLevel) && normalizeEducationLevel(item.degree) === selectedLevel
    )) || fallbackEducation[index];
    if (!fallback) return selected;

    const merged = { ...fallback, ...selected };
    for (const key of Object.keys(fallback) as Array<keyof EducationInfo>) {
      const selectedValue = selected[key];
      if (typeof selectedValue !== 'string' || !selectedValue.trim()) {
        Object.assign(merged, { [key]: fallback[key] });
      }
    }
    merged.id = selected.id || fallback.id;
    return merged;
  });
}

function normalizeResumeProfileSnapshot(snapshot: ResumeProfileSnapshot): ResumeProfileSnapshot {
  return {
    personal: { ...snapshot.personal },
    education: (snapshot.education || []).map(normalizeEducation),
    experience: (snapshot.experience || []).map(normalizeExperience),
    projects: (snapshot.projects || []).map(normalizeProject),
    skills: [...(snapshot.skills || [])],
  };
}

function normalizeExperience(
  value: Partial<ExperienceInfo>,
  index: number,
): ExperienceInfo {
  return {
    id: value.id || `resume-exp-${index + 1}`,
    company: value.company || '',
    position: value.position || '',
    startDate: value.startDate || '',
    endDate: value.endDate || '',
    description: value.description || '',
    achievements: value.achievements || '',
  };
}

function normalizeProject(
  value: Partial<ProjectInfo>,
  index: number,
): ProjectInfo {
  return {
    id: value.id || `resume-project-${index + 1}`,
    name: value.name || '',
    role: value.role || '',
    startDate: value.startDate || '',
    endDate: value.endDate || '',
    description: value.description || '',
    achievements: value.achievements || '',
    technologies: value.technologies || '',
  };
}

export function createResumeProfileSnapshot(parsed: ParsedResumeData): ResumeProfileSnapshot {
  return normalizeResumeProfileSnapshot({
    personal: { ...(parsed.personal || {}) },
    education: (parsed.education || []).map(normalizeEducation),
    experience: (parsed.experience || []).map(normalizeExperience),
    projects: (parsed.projects || []).map(normalizeProject),
    skills: [...(parsed.skills || [])],
  });
}

export function getResumeLibrary(profile: Pick<UserProfile, 'resume' | 'resumes'>): ResumeVariant[] {
  if (profile.resumes?.length) return profile.resumes;
  return profile.resume?.fileData
    ? [{ ...profile.resume, id: LEGACY_RESUME_ID, category: '默认简历' }]
    : [];
}

export function resolveResumeSelection(
  profile: Pick<UserProfile, 'resume' | 'resumes'>,
  resumeId: string | null | undefined,
): ResumeInfo | undefined {
  if (resumeId === null) return undefined;
  if (resumeId === undefined) return profile.resume || getResumeLibrary(profile)[0];
  return getResumeLibrary(profile).find(resume => resume.id === resumeId);
}

/**
 * 使用所选简历的独立解析结果生成本次填写资料。
 * 联系方式等简历未包含的基本信息回退到用户手动维护的全局资料；
 * 经历、项目和技能则严格跟随所选简历，避免不同岗位版本互相串数据。
 */
export function buildProfileForResume(
  profile: UserProfile,
  resumeId: string | null | undefined,
): UserProfile {
  const selected = resolveResumeSelection(profile, resumeId) as ResumeVariant | undefined;
  if (!selected?.parsedProfile) return profile;

  const parsedPersonal = Object.fromEntries(
    Object.entries(selected.parsedProfile.personal)
      .filter(([, value]) => typeof value === 'string' && value.trim()),
  );
  return {
    ...profile,
    personal: { ...profile.personal, ...parsedPersonal },
    education: mergeEducationWithFallback(selected.parsedProfile.education, profile.education),
    experience: selected.parsedProfile.experience,
    projects: selected.parsedProfile.projects,
    skills: selected.parsedProfile.skills,
    resume: selected,
  };
}

export function normalizeResumeLibrary(profile: Pick<UserProfile, 'resume' | 'resumes'>): ResumeVariant[] {
  return getResumeLibrary(profile).map((resume, index) => ({
    ...resume,
    id: resume.id?.trim() || `resume-${index + 1}`,
    category: resume.category?.trim() || '未分类',
    ...(resume.parsedProfile ? { parsedProfile: normalizeResumeProfileSnapshot(resume.parsedProfile) } : {}),
  }));
}
