-- Location unlock system.
-- scenarios.location_graph: authored graph of locations + unlock conditions (nullable — system is optional).
-- rooms.location_state: live per-room state (current location, statuses, evidence found).

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS location_graph JSONB DEFAULT NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS location_state JSONB DEFAULT NULL;
