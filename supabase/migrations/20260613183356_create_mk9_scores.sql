
CREATE TABLE IF NOT EXISTS mk9_scores (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  winner     text        NOT NULL CHECK (winner IN ('player', 'bot')),
  difficulty integer     NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  player_color text      NOT NULL DEFAULT '#dc2626',
  bot_color    text      NOT NULL DEFAULT '#2563eb',
  player_hp_remaining integer NOT NULL DEFAULT 0,
  session_id text        NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE mk9_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_mk9" ON mk9_scores
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_select_mk9" ON mk9_scores
  FOR SELECT TO anon USING (true);
