ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS winning_targets TEXT;
