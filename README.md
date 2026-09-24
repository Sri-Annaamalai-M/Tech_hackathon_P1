# SentinelFlow

SentinelFlow is a focused, AI-assisted pull request security review demo. It processes GitHub pull request webhooks, asks OpenAI for specific security findings, stores scan history in PostgreSQL, posts a review comment back to the PR, and shows scan history in a web dashboard.

## Features

- Web dashboard for PR scan history, risk scores, findings, and vulnerability trends.
- Node.js webhook server for GitHub `pull_request` events.
- GitHub webhook signature verification.
- OpenAI-powered security review for SQL injection, insecure dependency usage, auth bypass, XSS, SSRF, command injection, unsafe crypto, and related risks.
- PostgreSQL audit schema for repositories, PRs, scans, vulnerabilities, and trend rollups.
- Finding triage statuses: `open`, `fixed`, `accepted_risk`, and `false_positive`.

## Project Structure

```text
.
├── db/schema.sql
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── specs/sentinelflow_design.md
├── src/
│   ├── config.js
│   ├── db.js
│   ├── github.js
│   ├── openaiReviewer.js
│   ├── server.js
│   └── webhook.js
├── .env.example
├── .gitignore
└── package.json
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a PostgreSQL database named `sentinelflow`, then copy environment values:

   ```bash
   cp .env.example .env
   ```

3. Update `.env` with:

   - `DATABASE_URL`
   - `GITHUB_WEBHOOK_SECRET`
   - `GITHUB_TOKEN`
   - `OPENAI_API_KEY`

4. Apply the schema:

   ```bash
   npm run db:migrate
   ```

5. Start the server:

   ```bash
   npm run dev
   ```

6. Open the dashboard:

   ```text
   http://localhost:3000
   ```

## GitHub Webhook

Create a repository webhook with:

- Payload URL: `https://your-public-url/webhooks/github`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Event: Pull requests

For local demos, expose port `3000` with a tunnel and use that public URL.

## Required GitHub Token Permissions

Use a fine-grained token scoped to the repository:

- Contents: read
- Pull requests: read/write
- Issues: read/write, because GitHub PR comments use the Issues comments API

## Database Notes

The schema in `db/schema.sql` documents persistent audit logging and trend storage:

- `scans` stores each AI review run, status, risk score, model, and delivery ID.
- `vulnerabilities` stores specific findings, evidence, recommendations, CWE, confidence, and triage state.
- `vulnerability_trends` stores daily rollups by repository, category, and severity.

All database writes in the application use parameterized SQL queries.
