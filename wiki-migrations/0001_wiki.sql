CREATE TABLE entries ( id INTEGER PRIMARY KEY, entry_type TEXT NOT NULL CHECK (entry_type IN ('artist', 'band', 'label')), name TEXT NOT NULL CHECK (length(trim(name)) > 0), slug TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK ( length(slug) > 0 AND slug NOT GLOB '*[^a-z0-9-]*' AND substr(slug, 1, 1) <> '-' AND substr(slug, -1, 1) <> '-' ), summary TEXT NOT NULL DEFAULT '', body_markdown TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')), published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK (status <> 'published' OR published_at IS NOT NULL) );

CREATE TABLE genres ( id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, slug TEXT NOT NULL COLLATE NOCASE UNIQUE );

CREATE TABLE aliases ( id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0), alias_type TEXT NOT NULL DEFAULT 'alternate' CHECK (alias_type IN ('alternate', 'former', 'stylization')), notes TEXT NOT NULL DEFAULT '', UNIQUE (entry_id, name) );

CREATE TABLE artist_details ( entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, active_from_year INTEGER CHECK (active_from_year BETWEEN 1000 AND 9999), active_to_year INTEGER CHECK (active_to_year BETWEEN 1000 AND 9999), CHECK ( active_to_year IS NULL OR active_from_year IS NULL OR active_to_year >= active_from_year ) );

CREATE TABLE band_details ( entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, formed_year INTEGER CHECK (formed_year BETWEEN 1000 AND 9999), disbanded_year INTEGER CHECK (disbanded_year BETWEEN 1000 AND 9999), CHECK ( disbanded_year IS NULL OR formed_year IS NULL OR disbanded_year >= formed_year ) );

CREATE TABLE entry_genres ( entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE RESTRICT, PRIMARY KEY (entry_id, genre_id) );

CREATE TABLE entry_images ( id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, r2_key TEXT NOT NULL CHECK (length(trim(r2_key)) > 0), alt_text TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '', credit TEXT NOT NULL DEFAULT '', source_url TEXT, rights_notes TEXT NOT NULL DEFAULT '', is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)), sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (entry_id, r2_key) );

CREATE TABLE entry_links ( id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, label TEXT NOT NULL, url TEXT NOT NULL CHECK (url LIKE 'https://%' OR url LIKE 'http://%'), sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (entry_id, url) );

CREATE TABLE entry_revisions ( id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, revision_number INTEGER NOT NULL CHECK (revision_number > 0), snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)), change_note TEXT NOT NULL DEFAULT '', editor_reference TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (entry_id, revision_number) );

CREATE TABLE entry_sources ( id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, title TEXT NOT NULL, url TEXT CHECK ( url IS NULL OR url LIKE 'https://%' OR url LIKE 'http://%' ), publisher TEXT NOT NULL DEFAULT '', accessed_on TEXT, citation_notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0 );

CREATE TABLE label_details ( entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, founded_year INTEGER CHECK (founded_year BETWEEN 1000 AND 9999), closed_year INTEGER CHECK (closed_year BETWEEN 1000 AND 9999), CHECK ( closed_year IS NULL OR founded_year IS NULL OR closed_year >= founded_year ) );

CREATE TABLE relationships ( id INTEGER PRIMARY KEY, source_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, target_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, relationship_type TEXT NOT NULL CHECK (relationship_type IN ('membership', 'label_affiliation', 'related')), role TEXT NOT NULL DEFAULT '', start_year INTEGER CHECK (start_year BETWEEN 1000 AND 9999), end_year INTEGER CHECK (end_year BETWEEN 1000 AND 9999), is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)), notes TEXT NOT NULL DEFAULT '', CHECK (source_entry_id <> target_entry_id), CHECK ( end_year IS NULL OR start_year IS NULL OR end_year >= start_year ), CHECK (is_current = 0 OR end_year IS NULL) );

CREATE INDEX aliases_search ON aliases(name);

CREATE INDEX entries_browse ON entries(status, entry_type, name);

CREATE INDEX entry_genres_by_genre ON entry_genres(genre_id, entry_id);

CREATE UNIQUE INDEX entry_images_one_primary ON entry_images(entry_id) WHERE is_primary = 1;

CREATE INDEX entry_sources_by_entry ON entry_sources(entry_id);

CREATE INDEX relationships_from ON relationships(source_entry_id, relationship_type);

CREATE INDEX relationships_to ON relationships(target_entry_id, relationship_type);

CREATE TRIGGER artist_details_owner_fixed BEFORE UPDATE OF entry_id ON artist_details WHEN NEW.entry_id <> OLD.entry_id BEGIN SELECT RAISE(ABORT, 'Detail entry ID cannot be changed'); END;

CREATE TRIGGER artist_details_type_insert BEFORE INSERT ON artist_details WHEN NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.entry_id AND entry_type = 'artist' ) BEGIN SELECT RAISE(ABORT, 'Artist details require an artist entry'); END;

CREATE TRIGGER band_details_owner_fixed BEFORE UPDATE OF entry_id ON band_details WHEN NEW.entry_id <> OLD.entry_id BEGIN SELECT RAISE(ABORT, 'Detail entry ID cannot be changed'); END;

CREATE TRIGGER band_details_type_insert BEFORE INSERT ON band_details WHEN NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.entry_id AND entry_type = 'band' ) BEGIN SELECT RAISE(ABORT, 'Band details require a band entry'); END;

CREATE TRIGGER entries_type_fixed BEFORE UPDATE OF entry_type ON entries WHEN NEW.entry_type <> OLD.entry_type BEGIN SELECT RAISE(ABORT, 'Entry type cannot be changed'); END;

CREATE TRIGGER label_details_owner_fixed BEFORE UPDATE OF entry_id ON label_details WHEN NEW.entry_id <> OLD.entry_id BEGIN SELECT RAISE(ABORT, 'Detail entry ID cannot be changed'); END;

CREATE TRIGGER label_details_type_insert BEFORE INSERT ON label_details WHEN NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.entry_id AND entry_type = 'label' ) BEGIN SELECT RAISE(ABORT, 'Label details require a label entry'); END;

CREATE TRIGGER relationships_validate_insert BEFORE INSERT ON relationships WHEN NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.source_entry_id ) OR NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.target_entry_id ) OR ( NEW.relationship_type = 'membership' AND NOT EXISTS ( SELECT 1 FROM entries s, entries t WHERE s.id = NEW.source_entry_id AND s.entry_type = 'artist' AND t.id = NEW.target_entry_id AND t.entry_type = 'band' ) ) OR ( NEW.relationship_type = 'label_affiliation' AND NOT EXISTS ( SELECT 1 FROM entries s, entries t WHERE s.id = NEW.source_entry_id AND s.entry_type IN ('artist', 'band') AND t.id = NEW.target_entry_id AND t.entry_type = 'label' ) ) BEGIN SELECT RAISE(ABORT, 'Invalid relationship endpoints'); END;

CREATE TRIGGER relationships_validate_update BEFORE UPDATE OF source_entry_id, target_entry_id, relationship_type ON relationships WHEN NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.source_entry_id ) OR NOT EXISTS ( SELECT 1 FROM entries WHERE id = NEW.target_entry_id ) OR ( NEW.relationship_type = 'membership' AND NOT EXISTS ( SELECT 1 FROM entries s, entries t WHERE s.id = NEW.source_entry_id AND s.entry_type = 'artist' AND t.id = NEW.target_entry_id AND t.entry_type = 'band' ) ) OR ( NEW.relationship_type = 'label_affiliation' AND NOT EXISTS ( SELECT 1 FROM entries s, entries t WHERE s.id = NEW.source_entry_id AND s.entry_type IN ('artist', 'band') AND t.id = NEW.target_entry_id AND t.entry_type = 'label' ) ) BEGIN SELECT RAISE(ABORT, 'Invalid relationship endpoints'); END;

INSERT INTO genres (name, slug) VALUES
  ('Synthwave', 'synthwave'),
  ('Darksynth', 'darksynth'),
  ('EBM', 'ebm'),
  ('Industrial', 'industrial'),
  ('Synthpop', 'synthpop'),
  ('Hard Techno', 'hard-techno');
