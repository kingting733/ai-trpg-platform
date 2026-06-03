-- Seeds: insert the 3 built-in demo scenarios into the database.
--
-- HOW TO RUN:
--   1. Go to your Supabase dashboard → SQL Editor
--   2. Paste this entire file and click Run
--   3. The 3 demo scenarios will appear in the Scenario Library
--
-- NOTE: This uses the first authenticated user as the creator.
--       Make sure you have signed up at least once before running this.

DO $$
DECLARE
  system_user_id uuid;
BEGIN
  -- Use the earliest registered user as the scenario creator
  SELECT id INTO system_user_id
  FROM auth.users
  ORDER BY created_at ASC
  LIMIT 1;

  IF system_user_id IS NULL THEN
    RAISE EXCEPTION 'No users found. Please sign up first, then run this seed.';
  END IF;

  INSERT INTO public.scenarios (id, creator_id, title, genre, description, background, objective, rules, max_players, status)
  VALUES
    (
      '00000000-0000-0000-0000-000000000001',
      system_user_id,
      'The Lost Temple',
      'Fantasy',
      'An ancient temple hides deadly secrets and forgotten treasures. Your party must navigate traps, solve puzzles, and face the guardian within.',
      'Deep in the jungle, a long-forgotten temple has been rediscovered. Legends say it holds the Shard of Eternity — but countless adventurers who sought it were never seen again.',
      'Reach the inner sanctum and retrieve the Shard of Eternity before the temple collapses at dawn.',
      'Build tension gradually. Reward clever thinking and teamwork. Traps should be avoidable if players are cautious.',
      4,
      'published'
    ),
    (
      '00000000-0000-0000-0000-000000000002',
      system_user_id,
      'Neon Shadows',
      'Cyberpunk',
      'Navigate a corrupt megacity where corporations rule everything. Hack, fight, and deceive your way to the truth.',
      'Neo-Kyoto, 2087. The megacorp Axiom Corp controls water, food, and information. A whistleblower has gone missing — and they left a data chip with your name on it.',
      'Find the missing whistleblower and expose Axiom Corp''s secret before the corporation silences you.',
      'Players with high INT can attempt hacking. High CHA allows social manipulation. Combat is dangerous — encourage creative solutions.',
      6,
      'published'
    ),
    (
      '00000000-0000-0000-0000-000000000003',
      system_user_id,
      'The Haunting',
      'Horror',
      'Investigate strange occurrences in an abandoned mansion. Not everything that lurks in the dark is what it seems.',
      'The Ashford Mansion has been empty for 30 years, ever since the entire family disappeared overnight. You were hired to appraise the estate — but something inside does not want you to leave.',
      'Uncover what happened to the Ashford family and escape the mansion before midnight.',
      'This is survival horror. Build dread slowly. High SAN protects against mental breaks. Players who lose all SAN may act irrationally.',
      4,
      'published'
    )
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Demo scenarios seeded successfully (creator: %)', system_user_id;
END $$;
