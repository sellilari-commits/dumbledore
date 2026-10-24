/**
 * Schema v1 (docs/PLAN.md §6.7) as one SQL string, applied by migrations.ts.
 *
 * Conventions: every entity table has `seq INTEGER PRIMARY KEY` (stable insertion order, which
 * the in-memory twin exposes through Map order) and a unique text `id`. Arrays and objects are
 * JSON text. `*_key` columns hold normalizeName() of a name/title for case-insensitive lookups
 * (concept names are matched by conceptKey() in code; see concept-key.ts).
 * `search_fts` is an FTS5 trigram index over normalized text; its rowid is `seq * 4 + kind`.
 */
export const SCHEMA_V1 = `
CREATE TABLE subjects (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL,
  goal TEXT,
  deadline TEXT,
  status TEXT NOT NULL,
  focus TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX subjects_name_key ON subjects (name_key);

CREATE TABLE concepts (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  subject_id TEXT NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES concepts (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  mastery REAL NOT NULL,
  box INTEGER NOT NULL,
  next_review_at TEXT,
  status TEXT NOT NULL,
  struggle_count INTEGER NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX concepts_subject ON concepts (subject_id, name_key);
CREATE INDEX concepts_parent ON concepts (parent_id);
CREATE INDEX concepts_due ON concepts (next_review_at) WHERE next_review_at IS NOT NULL;
CREATE INDEX concepts_status ON concepts (status);

CREATE TABLE episodes (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  bundle_id TEXT NOT NULL,
  app TEXT NOT NULL,
  title TEXT,
  url TEXT,
  kind TEXT NOT NULL,
  ai_provider TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  dwell_seconds REAL NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  signals TEXT NOT NULL,
  extracted INTEGER NOT NULL
);
CREATE INDEX episodes_ended ON episodes (ended_at);
CREATE INDEX episodes_unextracted ON episodes (extracted, ended_at);

CREATE TABLE encounters (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  subject_id TEXT REFERENCES subjects (id) ON DELETE SET NULL,
  concept_id TEXT REFERENCES concepts (id) ON DELETE SET NULL,
  episode_id TEXT,
  seen TEXT NOT NULL,
  big_picture TEXT NOT NULL,
  topic_path TEXT NOT NULL,
  understanding TEXT NOT NULL,
  evidence TEXT NOT NULL,
  open_questions TEXT NOT NULL,
  key_terms TEXT NOT NULL,
  source TEXT NOT NULL,
  dwell_seconds REAL NOT NULL,
  inbox_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX encounters_subject ON encounters (subject_id, created_at);
CREATE INDEX encounters_concept ON encounters (concept_id);
CREATE INDEX encounters_inbox ON encounters (inbox_state, created_at);
CREATE INDEX encounters_created ON encounters (created_at);

CREATE TABLE assignments (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  subject_id TEXT REFERENCES subjects (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  course TEXT,
  due_at TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX assignments_title_key ON assignments (title_key);
CREATE INDEX assignments_subject ON assignments (subject_id);

CREATE TABLE roadmaps (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  subject_id TEXT NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  start_reason TEXT NOT NULL,
  offer_placement INTEGER NOT NULL,
  estimated_minutes REAL NOT NULL,
  status TEXT NOT NULL,
  carry TEXT NOT NULL,
  next_milestone TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX roadmaps_subject ON roadmaps (subject_id, status);

CREATE TABLE roadmap_items (
  roadmap_id TEXT NOT NULL REFERENCES roadmaps (id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  objective TEXT,
  concepts TEXT,
  move TEXT,
  prompt_draft TEXT,
  prompt_sent TEXT,
  covers TEXT,
  probes TEXT,
  n_questions INTEGER,
  quiz_id TEXT,
  score REAL,
  PRIMARY KEY (roadmap_id, pos)
);

CREATE TABLE quizzes (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_ids TEXT NOT NULL,
  roadmap_id TEXT,
  roadmap_item_id TEXT,
  status TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX quizzes_kind ON quizzes (kind, created_at);

CREATE TABLE questions (
  quiz_id TEXT NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  id TEXT NOT NULL,
  concept_name TEXT NOT NULL,
  concept_id TEXT,
  stem TEXT NOT NULL,
  options TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  rationales TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  carried_from TEXT,
  PRIMARY KEY (quiz_id, pos)
);
CREATE INDEX questions_concept ON questions (concept_id);

CREATE TABLE answers (
  quiz_id TEXT NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  chosen_index INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (quiz_id, pos)
);

CREATE TABLE nudges (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  shown_at TEXT,
  outcome TEXT NOT NULL
);
CREATE INDEX nudges_created ON nudges (created_at);
CREATE INDEX nudges_dedupe ON nudges (dedupe_key, created_at);

CREATE TABLE chat_messages (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  thread TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  actions TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX chat_messages_thread ON chat_messages (thread, seq);

CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  about_me TEXT NOT NULL,
  level TEXT,
  prompt_language TEXT NOT NULL,
  habits TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE llm_calls (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tier TEXT NOT NULL,
  task TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  latency_ms REAL NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX llm_calls_at ON llm_calls (at);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
);
CREATE INDEX events_at ON events (at);

CREATE VIRTUAL TABLE search_fts USING fts5 (f1, f2, f3, tokenize = 'trigram case_sensitive 1');
`
