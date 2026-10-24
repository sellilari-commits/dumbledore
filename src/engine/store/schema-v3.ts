/**
 * Schema v3: a subject's study preferences (what the student said its roadmap should and should
 * not cover, mapped onto the concept tree), as JSON on the subject row. See StudyPreferences.
 */
export const SCHEMA_V3 = `
ALTER TABLE subjects ADD COLUMN study_prefs TEXT;
`
