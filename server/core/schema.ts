// Core state schema (spec §44). SQLite holds state and metadata only; artifact
// bodies live on disk under projects/<id>/ (spec §45).
//
// Project isolation is enforced by the database itself, not just by callers:
// every project-scoped child row carries project_id, and child -> parent
// foreign keys are composite (id, project_id) (so ON DELETE SET NULL is not
// used on them: SQLite would null project_id too). A task cannot reference a
// mission, an artifact cannot reference a task, etc. from another project.

export const TASK_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting",
  "validation",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "paused",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MISSION_STATUSES = ["draft", "planning", "running", "paused", "completed", "failed", "cancelled"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const FREE_STATUSES = ["free", "free_tier", "trial", "paid", "unknown"] as const;
export type FreeStatus = (typeof FREE_STATUSES)[number];

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

export const SCHEMA_VERSION = 1;

export const SCHEMA_V1 = `
CREATE TABLE projects (
  id          TEXT PRIMARY KEY CHECK (id GLOB '[A-Za-z0-9_-]*' AND id NOT GLOB '*[^A-Za-z0-9_-]*' AND length(id) BETWEEN 1 AND 100),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  legacy_id   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE missions (
  id                      TEXT NOT NULL PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal                    TEXT NOT NULL,
  constraints             TEXT NOT NULL DEFAULT '[]',
  budget_policy           TEXT NOT NULL DEFAULT 'free_only' CHECK (budget_policy IN ('free_only', 'allow_paid')),
  technology_preferences  TEXT NOT NULL DEFAULT '[]',
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (${list(MISSION_STATUSES)})),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (id, project_id)
);

CREATE TABLE tasks (
  id                TEXT NOT NULL PRIMARY KEY,
  project_id        TEXT NOT NULL,
  mission_id        TEXT NOT NULL,
  role              TEXT NOT NULL,
  objective         TEXT NOT NULL DEFAULT '',
  inputs            TEXT NOT NULL DEFAULT '[]',
  expected_outputs  TEXT NOT NULL DEFAULT '[]',
  constraints       TEXT NOT NULL DEFAULT '[]',
  selected_ai       TEXT,
  automation_level  INTEGER NOT NULL DEFAULT 1 CHECK (automation_level BETWEEN 1 AND 3),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (${list(TASK_STATUSES)})),
  retry_count       INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 5),
  validation        TEXT,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (id, project_id),
  FOREIGN KEY (mission_id, project_id) REFERENCES missions(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_tasks_project ON tasks(project_id, position);

-- Task Graph edges (a task's "next_tasks" are the reverse of these).
CREATE TABLE task_edges (
  project_id  TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  depends_on  TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on),
  FOREIGN KEY (task_id, project_id) REFERENCES tasks(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on, project_id) REFERENCES tasks(id, project_id) ON DELETE CASCADE
);

CREATE TABLE ai_services (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  url                TEXT,
  provider           TEXT,
  languages          TEXT NOT NULL DEFAULT '[]',
  access_mode        TEXT NOT NULL DEFAULT 'web' CHECK (access_mode IN ('web', 'cli', 'local', 'browser', 'manual', 'api')),
  automation_level   INTEGER NOT NULL DEFAULT 1 CHECK (automation_level BETWEEN 1 AND 3),
  free_status        TEXT NOT NULL DEFAULT 'unknown' CHECK (free_status IN (${list(FREE_STATUSES)})),
  free_limit         TEXT,
  requires_login     INTEGER NOT NULL DEFAULT 0 CHECK (requires_login IN (0, 1)),
  requires_api_key   INTEGER NOT NULL DEFAULT 0 CHECK (requires_api_key IN (0, 1)),
  api_cost           TEXT,
  quality_score      REAL CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 5),
  reliability_score  REAL CHECK (reliability_score IS NULL OR reliability_score BETWEEN 0 AND 5),
  last_verified_at   TEXT,
  adapter_type       TEXT NOT NULL DEFAULT 'manual',
  limitations        TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unavailable', 'retired')),
  legacy_name        TEXT
);

CREATE TABLE ai_capabilities (
  ai_id       TEXT NOT NULL REFERENCES ai_services(id) ON DELETE CASCADE,
  capability  TEXT NOT NULL,
  score       REAL CHECK (score IS NULL OR score BETWEEN 0 AND 5),
  PRIMARY KEY (ai_id, capability)
);
CREATE INDEX idx_ai_capabilities_cap ON ai_capabilities(capability);

CREATE TABLE ai_runs (
  id                TEXT NOT NULL PRIMARY KEY,
  project_id        TEXT NOT NULL,
  task_id           TEXT,
  ai_id             TEXT REFERENCES ai_services(id) ON DELETE SET NULL,
  executor          TEXT NOT NULL,
  automation_level  INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  exit_code         INTEGER,
  summary           TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id, project_id) REFERENCES tasks(id, project_id) ON DELETE CASCADE
);

CREATE TABLE artifacts (
  id                 TEXT NOT NULL PRIMARY KEY,
  project_id         TEXT NOT NULL,
  task_id            TEXT,
  path               TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  source_ai          TEXT,
  source_url         TEXT,
  validation_status  TEXT NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN ('unvalidated', 'passed', 'failed')),
  UNIQUE (id, project_id),
  UNIQUE (project_id, path, version),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id, project_id) REFERENCES tasks(id, project_id)
);

CREATE TABLE validations (
  id           TEXT NOT NULL PRIMARY KEY,
  project_id   TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  artifact_id  TEXT,
  level        INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6),
  status       TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
  detail       TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (task_id, project_id) REFERENCES tasks(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id, project_id) REFERENCES artifacts(id, project_id)
);

CREATE TABLE decisions (
  id                TEXT NOT NULL PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  reason            TEXT NOT NULL,
  alternatives      TEXT NOT NULL DEFAULT '[]',
  rejected_because  TEXT,
  is_assumption     INTEGER NOT NULL DEFAULT 0 CHECK (is_assumption IN (0, 1)),
  created_at        TEXT NOT NULL
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  task_id     TEXT,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_events_project ON events(project_id, id);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Write locks (spec §38): e.g. resource 'code:<projectId>' owned by 'claude-code'.
CREATE TABLE locks (
  resource     TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  owner        TEXT NOT NULL,
  acquired_at  TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
`;
