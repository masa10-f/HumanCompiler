-- Rollback: Remove note attachments
-- Run this after rolling back to the API without attachments.
-- The rows are deleted with the table, and with them the only record of which
-- files are in the storage bucket: empty the note-attachments bucket by hand
-- afterwards. Notes keep their <img data-attachment-id="..."> references,
-- which the older web editor drops the next time it saves the note.

DROP TABLE IF EXISTS public.note_attachments;
