import { describe, expect, it } from 'vitest'
import { isLegacyBundledResume, LATEX_TEMPLATES, parseResumePreview } from './latexTemplates'

describe('LaTeX templates', () => {
  it('offers exactly three focused examples', () => {
    expect(LATEX_TEMPLATES).toHaveLength(3)
    expect(LATEX_TEMPLATES.map((template) => template.kind)).toEqual(['resume', 'report', 'blank'])
  })

  it('uses neutral placeholder identity data in the professional CV', () => {
    const cv = LATEX_TEMPLATES[0]
    const preview = parseResumePreview(cv.source)

    expect(preview.name).toBe('Lorem Ipsum')
    expect(preview.role).toBe('Senior Software Engineer')
    expect(cv.source).not.toMatch(/Sourabh|Bajaj|Google|Coursera/i)
    expect(preview.experience).toHaveLength(2)
    expect(preview.experience.map((entry) => entry.organization)).toEqual(['Lorem Systems', 'Ipsum Technologies'])
    expect(preview.education).toHaveLength(1)
    expect(preview.projects).toHaveLength(1)
  })

  it('recognizes only the obsolete bundled resume for local migration', () => {
    expect(isLegacyBundledResume('resume-classic-software-engineer', '\\adName{Sourabh Bajaj}')).toBe(true)
    expect(isLegacyBundledResume('resume-classic-software-engineer', '\\adName{Lorem Ipsum}')).toBe(false)
    expect(isLegacyBundledResume('blank-article', '\\adName{Sourabh Bajaj}')).toBe(false)
  })
})
