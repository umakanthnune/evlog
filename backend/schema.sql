-- UKLabs EV Trip Log — schema
-- Run once against your Postgres database (Render/Railway/Supabase all work).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS chargers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_lower TEXT GENERATED ALWAYS AS (lower(name)) STORED,
  network TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chargers_name_lower_idx ON chargers(name_lower);

-- Trips are scoped to a device_id (an anonymous UUID the client generates and
-- keeps in localStorage). No login required for v1. Chargers/reviews below
-- are global and visible to everyone regardless of device_id.
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  distance_km NUMERIC DEFAULT 0,
  photos JSONB DEFAULT '[]',  -- array of base64 data URLs (see README for the S3 upgrade path)
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trips_device_idx ON trips(device_id);

CREATE TABLE IF NOT EXISTS trip_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  charger_id UUID NOT NULL REFERENCES chargers(id),
  charger_name TEXT NOT NULL,
  kwh NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  wait_min NUMERIC DEFAULT 0,
  rating SMALLINT DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  notes TEXT,
  photos JSONB DEFAULT '[]',
  trip_title TEXT,           -- denormalized for display on charger detail page
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_stops_trip_idx ON trip_stops(trip_id);
CREATE INDEX IF NOT EXISTS trip_stops_charger_idx ON trip_stops(charger_id);

CREATE TABLE IF NOT EXISTS trip_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_expenses_trip_idx ON trip_expenses(trip_id);
