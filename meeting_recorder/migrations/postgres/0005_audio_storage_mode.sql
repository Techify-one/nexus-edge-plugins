ALTER TABLE meeting_recorder_recordings ADD COLUMN audio_storage_mode TEXT NOT NULL DEFAULT 'r2' CHECK (audio_storage_mode IN ('r2', 'transient'));
