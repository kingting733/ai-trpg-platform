-- === Storage bucket for scenario cover images ===
-- Public-read bucket; only authenticated users may upload/update/delete, and
-- each user can only manage files under their own folder (auth.uid()/...).

INSERT INTO storage.buckets (id, name, public)
VALUES ('scenario-covers', 'scenario-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read (bucket is public, but make the SELECT policy explicit).
DROP POLICY IF EXISTS "scenario_covers_public_read" ON storage.objects;
CREATE POLICY "scenario_covers_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'scenario-covers');

-- Authenticated users may upload into their own folder (first path segment = uid).
DROP POLICY IF EXISTS "scenario_covers_insert_own" ON storage.objects;
CREATE POLICY "scenario_covers_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'scenario-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners may update/replace their own files.
DROP POLICY IF EXISTS "scenario_covers_update_own" ON storage.objects;
CREATE POLICY "scenario_covers_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'scenario-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners may delete their own files.
DROP POLICY IF EXISTS "scenario_covers_delete_own" ON storage.objects;
CREATE POLICY "scenario_covers_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'scenario-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
