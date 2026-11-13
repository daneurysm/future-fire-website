-- FutureFire Wiki: 0002_discography.sql
-- Target: futurefire-wiki (WIKI_DB), not futurefire-club-db.
-- Apply once, after backup and review. Requires SQLite/D1 foreign keys enabled.

CREATE TABLE releases (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (
    length(slug) > 0 AND slug NOT GLOB '*[^a-z0-9-]*'
    AND substr(slug, 1, 1) <> '-' AND substr(slug, -1, 1) <> '-'
  ),
  release_type TEXT NOT NULL CHECK (release_type IN
    ('album','ep','single','compilation','soundtrack','live_album','remix_release')),
  display_credit TEXT NOT NULL DEFAULT '',
  release_date TEXT,
  date_precision TEXT NOT NULL DEFAULT 'unknown'
    CHECK (date_precision IN ('unknown','year','month','day')),
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'published' OR published_at IS NOT NULL),
  CHECK (
    (date_precision = 'unknown' AND release_date IS NULL) OR
    (date_precision = 'year' AND release_date GLOB '[0-9][0-9][0-9][0-9]') OR
    (date_precision = 'month' AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
      AND CAST(substr(release_date, 6, 2) AS INTEGER) BETWEEN 1 AND 12) OR
    (date_precision = 'day' AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(release_date, '+0 days') = release_date)
  )
);

CREATE TABLE release_artists (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
  credit_role TEXT NOT NULL DEFAULT 'primary'
    CHECK (credit_role IN ('primary','featured','collaborator','compiler','other')),
  credited_as TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, entry_id, credit_role)
);

CREATE TABLE release_labels (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  label_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
  association_type TEXT NOT NULL DEFAULT 'release'
    CHECK (association_type IN ('release','license','distribution','other')),
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, label_entry_id, association_type)
);

CREATE TABLE release_tracks (
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  disc_number INTEGER NOT NULL DEFAULT 1 CHECK (disc_number > 0),
  track_number INTEGER NOT NULL CHECK (track_number > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (release_id, disc_number, track_number)
);

CREATE TABLE release_track_artists (
  track_id INTEGER NOT NULL REFERENCES release_tracks(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
  credit_role TEXT NOT NULL DEFAULT 'primary'
    CHECK (credit_role IN ('primary','featured','remixer','collaborator','other')),
  credited_as TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, entry_id, credit_role)
);

CREATE TABLE release_links (
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'other'
    CHECK (platform IN ('bandcamp','spotify','apple_music','soundcloud','youtube','official','other')),
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL CHECK (url LIKE 'https://%' OR url LIKE 'http://%'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (release_id, url)
);

CREATE TABLE release_sources (
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  url TEXT CHECK (url IS NULL OR url LIKE 'https://%' OR url LIKE 'http://%'),
  publisher TEXT NOT NULL DEFAULT '',
  accessed_on TEXT,
  citation_notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE release_images (
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL CHECK (length(trim(r2_key)) > 0),
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  rights_notes TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (release_id, r2_key)
);

CREATE TABLE release_relations (
  id INTEGER PRIMARY KEY,
  source_release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  target_release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN
    ('deluxe_edition_of','remaster_of','reissue_of','alternate_edition_of')),
  notes TEXT NOT NULL DEFAULT '',
  CHECK (source_release_id <> target_release_id),
  UNIQUE (source_release_id, target_release_id, relation_type)
);

CREATE TABLE release_formats (
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  format_type TEXT NOT NULL CHECK (format_type IN
    ('digital','streaming','cd','vinyl','cassette','minidisc','other')),
  format_description TEXT NOT NULL DEFAULT '',
  catalog_number TEXT NOT NULL DEFAULT '',
  label_entry_id INTEGER REFERENCES entries(id) ON DELETE RESTRICT,
  release_date TEXT,
  region TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (release_date IS NULL OR (
    release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(release_date, '+0 days') = release_date
  ))
);

CREATE INDEX releases_browse ON releases(status, release_type, title);
CREATE INDEX releases_date ON releases(release_date);
CREATE INDEX release_artists_by_entry ON release_artists(entry_id, release_id);
CREATE INDEX release_labels_by_label ON release_labels(label_entry_id, release_id);
CREATE INDEX release_tracks_by_release ON release_tracks(release_id, disc_number, track_number);
CREATE INDEX release_track_artists_by_entry ON release_track_artists(entry_id, track_id);
CREATE INDEX release_links_by_release ON release_links(release_id, sort_order);
CREATE INDEX release_sources_by_release ON release_sources(release_id, sort_order);
CREATE INDEX release_images_by_release ON release_images(release_id, sort_order);
CREATE UNIQUE INDEX release_images_one_primary ON release_images(release_id) WHERE is_primary = 1;
CREATE INDEX release_relations_by_target ON release_relations(target_release_id, relation_type);
CREATE INDEX release_formats_by_release ON release_formats(release_id, format_type);
CREATE INDEX release_formats_by_label ON release_formats(label_entry_id, release_id);

CREATE TRIGGER release_artists_type_insert BEFORE INSERT ON release_artists
WHEN NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.entry_id AND entry_type IN ('artist','band'))
BEGIN SELECT RAISE(ABORT, 'Release credit requires artist or band entry'); END;
CREATE TRIGGER release_artists_type_update BEFORE UPDATE OF entry_id ON release_artists
WHEN NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.entry_id AND entry_type IN ('artist','band'))
BEGIN SELECT RAISE(ABORT, 'Release credit requires artist or band entry'); END;

CREATE TRIGGER release_labels_type_insert BEFORE INSERT ON release_labels
WHEN NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.label_entry_id AND entry_type='label')
BEGIN SELECT RAISE(ABORT, 'Release label requires label entry'); END;
CREATE TRIGGER release_labels_type_update BEFORE UPDATE OF label_entry_id ON release_labels
WHEN NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.label_entry_id AND entry_type='label')
BEGIN SELECT RAISE(ABORT, 'Release label requires label entry'); END;

CREATE TRIGGER release_track_artists_type_insert BEFORE INSERT ON release_track_artists
WHEN NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.entry_id AND entry_type IN ('artist','band'))
BEGIN SELECT RAISE(ABORT, 'Track credit requires artist or band entry'); END;
CREATE TRIGGER release_track_artists_type_update BEFORE UPDATE OF entry_id ON release_track_artists
WHEN NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.entry_id AND entry_type IN ('artist','band'))
BEGIN SELECT RAISE(ABORT, 'Track credit requires artist or band entry'); END;

CREATE TRIGGER release_formats_label_insert BEFORE INSERT ON release_formats
WHEN NEW.label_entry_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM entries WHERE id=NEW.label_entry_id AND entry_type='label')
BEGIN SELECT RAISE(ABORT, 'Format label requires label entry'); END;
CREATE TRIGGER release_formats_label_update BEFORE UPDATE OF label_entry_id ON release_formats
WHEN NEW.label_entry_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM entries WHERE id=NEW.label_entry_id AND entry_type='label')
BEGIN SELECT RAISE(ABORT, 'Format label requires label entry'); END;
