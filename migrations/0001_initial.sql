PRAGMA foreign_keys = ON;
CREATE TABLE sessions (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES sessions(id), network_hash TEXT NOT NULL,
 mutation_token TEXT, state TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 0, preset TEXT,
 manifest TEXT, manifest_hash TEXT, idempotency_key TEXT, workflow_id TEXT, active_render_id TEXT,
 seed INTEGER NOT NULL, description_requests INTEGER NOT NULL DEFAULT 0, description_busy INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
 expires_at INTEGER NOT NULL, intermediates_expire_at INTEGER, cleanup_done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX projects_owner ON projects(owner_id, created_at);
CREATE INDEX projects_expiry ON projects(state, expires_at);
CREATE TABLE assets (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL,
 r2_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, width INTEGER, height INTEGER, duration REAL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX assets_project ON assets(project_id, kind);
CREATE TABLE characters (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), ordinal INTEGER NOT NULL,
 source_asset_id TEXT NOT NULL REFERENCES assets(id), name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
 provenance TEXT NOT NULL DEFAULT 'user', crop TEXT NOT NULL, framing TEXT NOT NULL,
 canonical_asset_id TEXT REFERENCES assets(id), wardrobe TEXT, reference_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX characters_project ON characters(project_id, ordinal);
CREATE TABLE shots (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), ordinal INTEGER NOT NULL, cast_ids TEXT NOT NULL,
 action_id TEXT NOT NULL, frame_asset_id TEXT REFERENCES assets(id), clip_asset_id TEXT REFERENCES assets(id),
 check_status TEXT NOT NULL DEFAULT 'pending', UNIQUE(project_id, ordinal)
);
CREATE TABLE attempts (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), artifact TEXT NOT NULL, revision INTEGER NOT NULL,
 stage TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_hash TEXT NOT NULL, prompt_version TEXT NOT NULL,
 request_id TEXT UNIQUE, state TEXT NOT NULL DEFAULT 'prepared', error_category TEXT, output_asset_id TEXT,
 estimate_micros INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(project_id, artifact, revision)
);
CREATE INDEX attempts_active ON attempts(state, stage);
CREATE TABLE reservations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), day TEXT NOT NULL,
 amount_micros INTEGER NOT NULL CHECK(amount_micros >= 0), state TEXT NOT NULL DEFAULT 'reserved',
 basis TEXT NOT NULL DEFAULT 'conservative_estimate', created_at INTEGER NOT NULL
);
CREATE INDEX reservations_day ON reservations(day, state);
CREATE TABLE webhook_inbox (
 request_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT,
 received_at INTEGER NOT NULL
);
CREATE TABLE renders (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), manifest_hash TEXT NOT NULL,
 clip_revisions TEXT NOT NULL, renderer_version TEXT NOT NULL, video_asset_id TEXT REFERENCES assets(id),
 poster_asset_id TEXT REFERENCES assets(id), state TEXT NOT NULL
);
CREATE TABLE shares (
 token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id), render_id TEXT NOT NULL REFERENCES renders(id),
 created_at INTEGER NOT NULL, revoked_at INTEGER, expires_at INTEGER NOT NULL
);
CREATE TABLE upload_tickets (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), mime TEXT NOT NULL, size INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', asset_id TEXT
);
CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL, project_id TEXT, preset TEXT, value REAL, created_at INTEGER NOT NULL);
CREATE INDEX events_created ON events(created_at);
