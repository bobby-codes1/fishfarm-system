-- Fish Farm Inventory Management System — Initial Schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── ENUMS ────────────────────────────────────────────────────────────────────

CREATE TYPE species_type AS ENUM ('catfish', 'tilapia');
CREATE TYPE pond_status AS ENUM ('active', 'harvested', 'empty');
CREATE TYPE batch_status AS ENUM ('active', 'harvested');

-- ─── PONDS ────────────────────────────────────────────────────────────────────

CREATE TABLE ponds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  species        species_type NOT NULL,
  capacity       INT NOT NULL,
  stocking_date  DATE,
  status         pond_status NOT NULL DEFAULT 'empty',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── FISH BATCHES ─────────────────────────────────────────────────────────────

CREATE TABLE fish_batches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id              UUID NOT NULL REFERENCES ponds(id) ON DELETE CASCADE,
  species              species_type NOT NULL,
  initial_count        INT NOT NULL,
  current_count        INT NOT NULL,
  avg_weight_kg        DECIMAL(6,3),
  stocking_date        DATE NOT NULL,
  target_harvest_date  DATE,
  status               batch_status NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── FEED INVENTORY ───────────────────────────────────────────────────────────

CREATE TABLE feed_inventory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_type             TEXT NOT NULL UNIQUE,
  quantity_kg           DECIMAL(10,2) NOT NULL DEFAULT 0,
  reorder_threshold_kg  DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_cost_ghs         DECIMAL(10,2),
  supplier              TEXT,
  last_updated          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DAILY LOGS ───────────────────────────────────────────────────────────────

CREATE TABLE daily_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id          UUID NOT NULL REFERENCES ponds(id) ON DELETE CASCADE,
  log_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  feed_type_id     UUID REFERENCES feed_inventory(id),
  feed_amount_kg   DECIMAL(8,2) NOT NULL DEFAULT 0,
  mortality_count  INT NOT NULL DEFAULT 0,
  notes            TEXT,
  logged_by        TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_logs_pond_date ON daily_logs(pond_id, log_date);
CREATE INDEX idx_daily_logs_date     ON daily_logs(log_date);

-- ─── HARVESTS ─────────────────────────────────────────────────────────────────

CREATE TABLE harvests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id            UUID NOT NULL REFERENCES ponds(id),
  batch_id           UUID NOT NULL REFERENCES fish_batches(id),
  harvest_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  total_weight_kg    DECIMAL(10,2) NOT NULL,
  fish_count         INT NOT NULL,
  avg_weight_kg      DECIMAL(6,3),
  buyer              TEXT,
  price_per_kg_ghs   DECIMAL(10,2),
  total_revenue_ghs  DECIMAL(12,2),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ALERTS LOG ───────────────────────────────────────────────────────────────

CREATE TABLE alerts_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type  TEXT NOT NULL,
  message     TEXT NOT NULL,
  sent_to     TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_alerts_sent_at ON alerts_log(sent_at DESC);
