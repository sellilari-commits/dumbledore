/**
 * Schema v4: feedback the student gave Dumbledore in the chat ("your quizzes are too easy"),
 * with the prompts it concerns (scope) and, when it is about one subject, that subject.
 */
export const SCHEMA_V4 = `
CREATE TABLE feedback (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  subject_id TEXT REFERENCES subjects (id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_scope ON feedback (scope, seq);
`
