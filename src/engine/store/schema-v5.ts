/**
 * Schema v5: roadmap history. A roadmap that is replaced (a replan, a new roadmap for the same
 * subject, or an earlier version brought back) is never deleted: it is marked superseded, with
 * when, by which roadmap and why. Superseded rows keep their status and items as they were; the
 * repo hides them from the current-roadmap reads and lists them as the subject's history.
 */
export const SCHEMA_V5 = `
ALTER TABLE roadmaps ADD COLUMN superseded_at TEXT;
ALTER TABLE roadmaps ADD COLUMN superseded_by TEXT;
ALTER TABLE roadmaps ADD COLUMN supersede_reason TEXT;
CREATE INDEX roadmaps_history ON roadmaps (subject_id, superseded_at);
`
