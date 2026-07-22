-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Preserve why a task was interrupted when Runner switches atomically.

ALTER TABLE work_sessions
    ADD COLUMN IF NOT EXISTS switch_disposition VARCHAR(16);

ALTER TABLE work_sessions
    ADD COLUMN IF NOT EXISTS interruption_note VARCHAR(2000);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'work_sessions_switch_disposition_check'
    ) THEN
        ALTER TABLE work_sessions
            ADD CONSTRAINT work_sessions_switch_disposition_check
            CHECK (
                switch_disposition IS NULL
                OR switch_disposition IN ('complete', 'pause', 'defer')
            );
    END IF;
END $$;
