ALTER TABLE assets ADD COLUMN removed_at INTEGER;
CREATE INDEX assets_cleanup ON assets(removed_at, expires_at);
