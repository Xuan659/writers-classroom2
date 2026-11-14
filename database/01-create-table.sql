-- Paste this entire statement into D1 -> writing-classroom-db -> Console -> Execute.
-- It creates an empty table and will not delete existing works.
CREATE TABLE IF NOT EXISTS submissions (
 seat INTEGER PRIMARY KEY CHECK (seat BETWEEN 1 AND 35),
 topic INTEGER NOT NULL DEFAULT 1 CHECK (topic BETWEEN 1 AND 3),
 token TEXT NOT NULL,
 answers TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'writing' CHECK (status IN ('writing','submitted')),
 updated TEXT NOT NULL,
 claim_id TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 last_request TEXT NOT NULL DEFAULT ''
);

