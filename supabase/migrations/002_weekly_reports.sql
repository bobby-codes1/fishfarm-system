-- Weekly AI reports storage

CREATE TABLE weekly_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date  DATE        NOT NULL,
  report_text  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weekly_reports_date ON weekly_reports(report_date DESC);
