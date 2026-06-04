-- Migration: Ending Condition Detection System
-- Run in the Supabase SQL Editor. Safe to run on an existing database.

-- Store the ending metadata on the room when the system detects a scenario ending.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS ending_type  TEXT,
  ADD COLUMN IF NOT EXISTS ending_title TEXT,
  ADD COLUMN IF NOT EXISTS ending_summary TEXT;
