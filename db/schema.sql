CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_repository_id BIGINT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  default_branch TEXT,
  html_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_pull_request_id BIGINT UNIQUE NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  author_login TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  base_sha TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  html_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, number)
);

CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_request_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'dismissed')),
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  files_analyzed INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  ai_model TEXT,
  github_delivery_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  evidence TEXT,
  recommendation TEXT NOT NULL,
  cwe TEXT,
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.70 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'accepted_risk', 'false_positive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vulnerability_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  trend_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repository_id, trend_date, category, severity)
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repository ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_scans_pull_request_created ON scans(pull_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan ON vulnerabilities(scan_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_category_severity ON vulnerabilities(category, severity);
CREATE INDEX IF NOT EXISTS idx_trends_repository_date ON vulnerability_trends(repository_id, trend_date DESC);

COMMENT ON TABLE scans IS 'One AI-assisted security review run for a pull request.';
COMMENT ON TABLE vulnerabilities IS 'Specific security findings generated during a scan, including remediation guidance and triage status.';
COMMENT ON TABLE vulnerability_trends IS 'Daily rollup used to track vulnerability category and severity movement over time.';
