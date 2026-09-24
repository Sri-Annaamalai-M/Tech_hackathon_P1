# SentinelFlow Technical Design

## Goal

SentinelFlow reduces noisy automated scan output into focused, developer-ready pull request security feedback. It accepts GitHub pull request webhook events, analyzes changed files with OpenAI, persists audit data in PostgreSQL, posts a formatted review comment, and exposes scan history through a web dashboard.

## Backend

- Node.js and Express provide the API and webhook processor.
- `POST /webhooks/github` validates the `x-hub-signature-256` HMAC before parsing payloads.
- Pull request events fetch changed files from GitHub using `GITHUB_TOKEN`.
- The OpenAI Responses API is asked to return strict JSON containing specific risks, severity, evidence, and fix recommendations.
- PostgreSQL stores repositories, pull requests, scans, findings, and daily trends using parameterized queries.

## Frontend

- The dashboard is served from `public/` by the same Express app.
- It shows scan history, risk scores, status, findings, and category trends.
- Scan findings can be triaged through status updates without editing raw database rows.

## Security

- Webhook signatures are verified with constant-time comparison.
- API payloads are validated with Zod.
- Database access uses parameterized queries only.
- Helmet and rate limiting are enabled.
- Secrets are loaded from environment variables and excluded through `.gitignore`.
- AI output is treated as untrusted and validated before storage.

## Acceptance Criteria

- Developers can run the dashboard locally.
- GitHub pull request webhook payloads create persisted scan records.
- OpenAI is invoked for PR code analysis when configured.
- Review comments are posted back to GitHub when a token is configured.
- PostgreSQL schema documents scan history and vulnerability trends.
