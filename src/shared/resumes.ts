import type { ResumeInfo, ResumeVariant, UserProfile } from './types.ts';

export const LEGACY_RESUME_ID = 'legacy-resume';

export function createResumeVariant(
  resume: ResumeInfo,
  options: { id: string; category?: string },
): ResumeVariant {
  return {
    ...resume,
    id: options.id,
    category: options.category?.trim() || '未分类',
    // fileName 始终直接继承浏览器提供的原文件名，不使用分类名改写。
    fileName: resume.fileName,
  };
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

export function normalizeResumeLibrary(profile: Pick<UserProfile, 'resume' | 'resumes'>): ResumeVariant[] {
  return getResumeLibrary(profile).map((resume, index) => ({
    ...resume,
    id: resume.id?.trim() || `resume-${index + 1}`,
    category: resume.category?.trim() || '未分类',
  }));
}
