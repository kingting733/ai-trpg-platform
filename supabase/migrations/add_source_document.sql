-- Full raw story text, stored so the AI GM can reference the WHOLE module at
-- play time (injected into the cached system prefix) instead of only the
-- lossy structured summary produced at import.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS source_document TEXT;
