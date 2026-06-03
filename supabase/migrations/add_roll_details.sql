-- Migration: add per-stat dice breakdown to character cards.
-- Safe to run on an existing database. Run in the Supabase SQL Editor.
ALTER TABLE public.character_cards
  ADD COLUMN IF NOT EXISTS roll_details JSONB;
