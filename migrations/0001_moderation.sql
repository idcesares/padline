-- ADR-0002. Three tables. None holds pad content, an evidence copy or an IP
-- address: slugs, sizes, categories and dates only.

-- The pad index: the operator's view of what exists. A display copy; the room
-- decides whether a pad is blocked. `status` mirrors the room after an admin
-- action and is otherwise 'live'.
CREATE TABLE pads (
  slug      TEXT PRIMARY KEY,
  size      INTEGER NOT NULL DEFAULT 0,   -- bytes of Yjs state at the last write
  created   INTEGER NOT NULL,             -- ms since epoch, first non-empty save
  last_edit INTEGER NOT NULL,             -- ms since epoch
  edits     INTEGER NOT NULL DEFAULT 1,   -- index writes: about one per active minute
  status    TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'emptied', 'blocked'))
);
CREATE INDEX pads_last_edit ON pads (last_edit DESC);
CREATE INDEX pads_size ON pads (size DESC);

-- Public reports. Keyed by slug with no foreign key: a report about a pad that
-- does not exist is stored like any other, so the response can never tell.
-- Deliberately no IP, user agent or any request header column.
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  category    TEXT NOT NULL,
  note        TEXT,
  contact     TEXT,
  created     INTEGER NOT NULL,
  resolved_at INTEGER                     -- set by dismiss, clear or block
);
CREATE INDEX reports_open ON reports (slug) WHERE resolved_at IS NULL;

-- What the operator did. Append-only: no code path updates or deletes a row.
CREATE TABLE actions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  action   TEXT NOT NULL CHECK (action IN ('clear', 'block', 'dismiss')),
  slug     TEXT NOT NULL,
  category TEXT
);
