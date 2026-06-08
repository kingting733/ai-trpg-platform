ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT DEFAULT NULL;
