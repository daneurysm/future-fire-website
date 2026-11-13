-- Migration 0003: Record label enhancements
-- Reproduces changes already installed in local and production databases.
-- Do not apply directly to those existing databases.

ALTER TABLE label_details ADD COLUMN headquarters TEXT NOT NULL DEFAULT '';
ALTER TABLE label_details ADD COLUMN founder_text TEXT NOT NULL DEFAULT '';
ALTER TABLE label_details ADD COLUMN parent_label_id INTEGER REFERENCES entries(id) ON DELETE SET NULL;
ALTER TABLE label_details ADD COLUMN catalog_prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE label_details ADD COLUMN status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (status IN ('active', 'inactive', 'defunct', 'unknown'));

CREATE INDEX label_details_parent ON label_details(parent_label_id);

CREATE TRIGGER label_parent_validate_insert
BEFORE INSERT ON label_details
WHEN NEW.parent_label_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entries
    WHERE id = NEW.parent_label_id AND entry_type = 'label'
  )
BEGIN
  SELECT RAISE(ABORT, 'Parent must be a label');
END;

CREATE TRIGGER label_parent_validate_update
BEFORE UPDATE OF parent_label_id ON label_details
WHEN NEW.parent_label_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entries
    WHERE id = NEW.parent_label_id AND entry_type = 'label'
  )
BEGIN
  SELECT RAISE(ABORT, 'Parent must be a label');
END;
