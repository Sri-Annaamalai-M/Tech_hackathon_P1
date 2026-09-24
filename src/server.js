import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './config.js';
import { query } from './db.js';
import { verifyGitHubSignature } from './github.js';
import { handlePullRequestWebhook } from './webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"]
      }
    }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    }
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.post('/webhooks/github', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res, next) => {
  try {
    const signature = req.header('x-hub-signature-256');
    const event = req.header('x-github-event');
    const deliveryId = req.header('x-github-delivery') || crypto.randomUUID();

    if (!verifyGitHubSignature(req.body, signature)) {
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid GitHub signature' } });
      return;
    }

    if (event !== 'pull_request') {
      res.status(202).json({ ignored: true, reason: `Unsupported event: ${event}` });
      return;
    }

    const payload = JSON.parse(req.body.toString('utf8'));
    const result = await handlePullRequestWebhook(payload, deliveryId);
    res.status(result.ignored ? 202 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', database: error.message });
  }
});

app.get('/api/scans', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const result = await query(
      `
        SELECT
          s.id,
          s.status,
          s.risk_score,
          s.files_analyzed,
          s.summary,
          s.created_at,
          s.completed_at,
          s.error_message,
          pr.number AS pr_number,
          pr.title AS pr_title,
          pr.author_login,
          pr.html_url AS pr_url,
          r.full_name AS repository,
          COUNT(v.id)::int AS finding_count,
          COUNT(v.id) FILTER (WHERE v.severity IN ('critical', 'high'))::int AS severe_count
        FROM scans s
        JOIN pull_requests pr ON pr.id = s.pull_request_id
        JOIN repositories r ON r.id = pr.repository_id
        LEFT JOIN vulnerabilities v ON v.scan_id = s.id
        GROUP BY s.id, pr.id, r.id
        ORDER BY s.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/scans/:id', async (req, res, next) => {
  try {
    const scanResult = await query(
      `
        SELECT
          s.*,
          pr.number AS pr_number,
          pr.title AS pr_title,
          pr.author_login,
          pr.html_url AS pr_url,
          r.full_name AS repository
        FROM scans s
        JOIN pull_requests pr ON pr.id = s.pull_request_id
        JOIN repositories r ON r.id = pr.repository_id
        WHERE s.id = $1
      `,
      [req.params.id]
    );

    if (!scanResult.rowCount) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scan not found' } });
      return;
    }

    const findings = await query(
      `
        SELECT *
        FROM vulnerabilities
        WHERE scan_id = $1
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END,
          created_at DESC
      `,
      [req.params.id]
    );

    res.json({ data: { ...scanResult.rows[0], findings: findings.rows } });
  } catch (error) {
    next(error);
  }
});

const StatusPatchSchema = z.object({
  status: z.enum(['open', 'fixed', 'accepted_risk', 'false_positive'])
});

app.patch('/api/findings/:id/status', async (req, res, next) => {
  try {
    const parsed = StatusPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid finding status' } });
      return;
    }

    const result = await query(
      `
        UPDATE vulnerabilities
        SET status = $2
        WHERE id = $1
        RETURNING *
      `,
      [req.params.id, parsed.data.status]
    );

    if (!result.rowCount) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Finding not found' } });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/trends', async (_req, res, next) => {
  try {
    const result = await query(
      `
        SELECT trend_date, category, severity, SUM(finding_count)::int AS finding_count
        FROM vulnerability_trends
        GROUP BY trend_date, category, severity
        ORDER BY trend_date DESC, finding_count DESC
        LIMIT 100
      `
    );

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'SentinelFlow could not complete the request'
    }
  });
});

app.listen(config.port, () => {
  console.log(`SentinelFlow listening on http://localhost:${config.port}`);
});
