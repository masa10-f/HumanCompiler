-- Migration: Add note attachments (images in context notes)
-- Date: 2026-11-24
-- Description: Creates note_attachments, one row per image attached to the
-- note of a project, goal or task (issues #408 and #471).
-- The image itself is in a private storage bucket: a preview (object_key) and
-- a thumbnail (thumb_object_key), both WebP. The original file is never
-- stored; source says where it came from (path, script, host, sha256), as the
-- uploader reported it. No URL is stored: the API signs a short-lived one on
-- every read, after checking user_id.
-- The note's HTML refers to an attachment by id
-- (<img data-attachment-id="...">). detached_at is the time since which the
-- note has not referred to it; it is set at upload and cleared by the note
-- write that adds the reference. The API's cleanup job deletes the stored
-- files and the row of an attachment detached for longer than the grace
-- period.
-- Deleting a note (or the project, goal or task it is on) keeps the row with
-- note_id NULL, so the cleanup job still knows which files to delete.
-- Deleting a user deletes the rows; the files under {user_id}/ in the bucket
-- must then be deleted by hand.
-- Additive only: the API deployed before this migration does not know the
-- table and keeps working. Apply it before deploying the API that serves
-- attachments: that API reads the table on every note save, so note saves
-- fail without it.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 046_add_note_attachments.sql.'';
    END IF;
    IF to_regclass(''public.context_notes'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.context_notes is missing. Apply earlier migrations before 046_add_note_attachments.sql.'';
    END IF;
    -- The disabled migration 016 created a table of the same name with
    -- another layout. It was never used, so it is safe to drop by hand.
    IF to_regclass(''public.note_attachments'') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(''public.note_attachments'')
          AND attname = ''object_key''
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION ''public.note_attachments exists with the layout of the disabled migration 016. Check that it is empty, drop it, then apply 046_add_note_attachments.sql again.'';
    END IF;
END
';

CREATE TABLE IF NOT EXISTS public.note_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    note_id UUID REFERENCES public.context_notes(id) ON DELETE SET NULL,
    bucket VARCHAR(100) NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    thumb_object_key VARCHAR(500) NOT NULL,
    byte_size INTEGER NOT NULL,
    thumb_byte_size INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    sha256 CHAR(64) NOT NULL,
    caption VARCHAR(500) NOT NULL DEFAULT '',
    source JSONB,
    detached_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_note_attachments_sizes CHECK (
        byte_size > 0 AND thumb_byte_size > 0 AND width > 0 AND height > 0
    )
);

-- The note's attachments (reference sync on every note write, and the
-- same-image lookup at upload).
CREATE INDEX IF NOT EXISTS idx_note_attachments_note
    ON public.note_attachments(note_id);

-- The user's attachments (storage quota, signed URL lookups).
CREATE INDEX IF NOT EXISTS idx_note_attachments_user
    ON public.note_attachments(user_id);

ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note_attachments_own_rows" ON public.note_attachments;

CREATE POLICY "note_attachments_own_rows" ON public.note_attachments
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

REVOKE ALL ON public.note_attachments FROM anon, authenticated;

-- Read only: an attachment is created and deleted by the API, which checks
-- the file and writes the bucket with it. No column holds a secret (the
-- bucket is private, so a key alone opens nothing).
GRANT SELECT ON public.note_attachments TO authenticated;

COMMENT ON TABLE public.note_attachments IS 'Images attached to context notes; the files are in a private storage bucket';
COMMENT ON COLUMN public.note_attachments.note_id IS 'The note the image was attached to; NULL once that note is deleted';
COMMENT ON COLUMN public.note_attachments.object_key IS 'Key of the preview (WebP) in the bucket; never a URL';
COMMENT ON COLUMN public.note_attachments.thumb_object_key IS 'Key of the thumbnail (WebP) in the bucket';
COMMENT ON COLUMN public.note_attachments.sha256 IS 'SHA-256 of the stored preview, hex';
COMMENT ON COLUMN public.note_attachments.caption IS 'What the image shows, for readers who cannot see it; follows the alt text in the note';
COMMENT ON COLUMN public.note_attachments.source IS 'Where the original came from, as the uploader reported it: path, script, host, sha256';
COMMENT ON COLUMN public.note_attachments.detached_at IS 'Since when the note has not referred to the attachment; NULL while it does';
