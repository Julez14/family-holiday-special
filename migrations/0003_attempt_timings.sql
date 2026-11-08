ALTER TABLE attempts ADD COLUMN submitted_at INTEGER;
ALTER TABLE attempts ADD COLUMN started_at INTEGER;
ALTER TABLE attempts ADD COLUMN completed_at INTEGER;
ALTER TABLE attempts ADD COLUMN provider_inference_ms REAL;
ALTER TABLE attempts ADD COLUMN review_calls INTEGER NOT NULL DEFAULT 0;
