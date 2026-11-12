PRAGMA foreign_keys = ON;

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  width INTEGER CHECK (width > 0),
  height INTEGER CHECK (height > 0),
  alt_text TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('news', 'review', 'weekly_report')),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status != 'published' OR published_at IS NOT NULL)
);
CREATE INDEX articles_public_feed ON articles(section, status, published_at DESC);

CREATE TABLE review_details (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  artist TEXT NOT NULL DEFAULT '',
  release_title TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  release_date TEXT,
  rating REAL CHECK (rating >= 0 AND rating <= 10),
  listen_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE article_media (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (article_id, media_id)
);

CREATE TABLE tour_dates (
  id TEXT PRIMARY KEY,
  artist TEXT NOT NULL CHECK (length(trim(artist)) > 0),
  venue TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  ticket_url TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  image_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tour_dates_public ON tour_dates(status, starts_at);

CREATE TABLE livestream_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL DEFAULT 'FutureFire / Live Transmission',
  description TEXT NOT NULL DEFAULT '',
  stream_url TEXT NOT NULL DEFAULT '',
  schedule_text TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  station_name TEXT NOT NULL DEFAULT 'KOSW Radio',
  station_frequency TEXT NOT NULL DEFAULT '88.9 FM',
  station_location TEXT NOT NULL DEFAULT 'Ocean Shores, WA',
  is_live INTEGER NOT NULL DEFAULT 0 CHECK (is_live IN (0, 1)),
  image_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO livestream_settings (id) VALUES (1);

CREATE TABLE site_sections (
  section TEXT PRIMARY KEY CHECK (section IN ('news', 'reviews', 'tour', 'livestream', 'matrix', 'global')),
  eyebrow TEXT NOT NULL DEFAULT '',
  heading TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO site_sections (section) VALUES ('news'), ('reviews'), ('tour'), ('livestream'), ('matrix'), ('global');

CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE social_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO social_links (id, name, handle, url, sort_order) VALUES
  ('facebook', 'Facebook', 'Future Fire', 'https://www.facebook.com/profile.php?id=61559516101158', 0),
  ('tiktok', 'TikTok', '@futurefirekosw', 'https://www.tiktok.com/@futurefirekosw?is_from_webapp=1&sender_device=pc', 1),
  ('instagram', 'Instagram', '@futurefirekosw', 'https://www.instagram.com/futurefirekosw/', 2),
  ('x', 'X', '@FutureFireKOSW', 'https://x.com/FutureFireKOSW', 3);
