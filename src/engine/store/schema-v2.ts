/**
 * Schema v2 (docs/NOTES.md §8): atomic notes and prerequisite edges between concepts, plus the
 * columns consolidation will use (`subjects.consolidated_at`, `concepts.summary_pinned`).
 *
 * `notes.subject_id` is nullable: a loose note (casual reading that matched no subject) has none
 * until the student files it. Search rows move from `seq * 4 + kind` to `seq * 8 + kind` so a
 * fifth kind (note) fits; the existing rows are renumbered here, in the same transaction.
 */
export const SCHEMA_V2 = `
CREATE TABLE notes (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  subject_id TEXT REFERENCES subjects (id) ON DELETE CASCADE,
  concept_id TEXT REFERENCES concepts (id) ON DELETE SET NULL,
  encounter_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  note_key TEXT NOT NULL,
  keywords TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  merged_into TEXT,
  pinned INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_concept ON notes (concept_id, status);
CREATE INDEX notes_subject ON notes (subject_id, updated_at);
CREATE INDEX notes_encounter ON notes (encounter_id);

CREATE TABLE concept_edges (
  from_id TEXT NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  why TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX concept_edges_to ON concept_edges (to_id);

ALTER TABLE subjects ADD COLUMN consolidated_at TEXT;
ALTER TABLE concepts ADD COLUMN summary_pinned INTEGER NOT NULL DEFAULT 0;

CREATE TEMP TABLE search_fts_v1 AS SELECT rowid AS r, f1, f2, f3 FROM search_fts;
DELETE FROM search_fts;
INSERT INTO search_fts (rowid, f1, f2, f3) SELECT (r / 4) * 8 + (r % 4), f1, f2, f3 FROM search_fts_v1;
DROP TABLE search_fts_v1;
`
