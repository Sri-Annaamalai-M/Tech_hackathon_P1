import { z } from 'zod';
import { config } from './config.js';
import { fetchPullRequestFiles, postPullRequestComment } from './github.js';
import { formatReviewComment, reviewPullRequest } from './openaiReviewer.js';
import { upsertPullRequest, upsertRepository, withTransaction } from './db.js';

const PullRequestEventSchema = z.object({
  action: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    default_branch: z.string().nullable().optional(),
    html_url: z.string().url(),
    owner: z.object({
      login: z.string()
    })
  }),
  pull_request: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    state: z.string(),
    html_url: z.string().url(),
    user: z.object({
      login: z.string()
    }),
    head: z.object({
      sha: z.string()
    }),
    base: z.object({
      sha: z.string()
    })
  })
});

const supportedActions = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);

export async function handlePullRequestWebhook(payload, deliveryId) {
  const parsed = PullRequestEventSchema.safeParse(payload);
  if (!parsed.success) {
    return { ignored: true, reason: 'Invalid pull_request payload' };
  }

  const event = parsed.data;
  if (!supportedActions.has(event.action) || payload.pull_request?.draft) {
    return { ignored: true, reason: `Unsupported pull request action: ${event.action}` };
  }

  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  let scanId;

  const files = await fetchPullRequestFiles(owner, repo, event.pull_request.number);

  await withTransaction(async (client) => {
    const repository = await upsertRepository(client, event.repository);
    const pullRequest = await upsertPullRequest(client, repository.id, event.pull_request);
    const scan = await client.query(
      `
        INSERT INTO scans (
          pull_request_id, status, files_analyzed, ai_model, github_delivery_id
        )
        VALUES ($1, 'running', $2, $3, $4)
        RETURNING id
      `,
      [pullRequest.id, files.length, config.openaiModel, deliveryId]
    );
    scanId = scan.rows[0].id;
  });

  try {
    const review = await reviewPullRequest({
      repository: event.repository,
      pullRequest: event.pull_request,
      files
    });

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE scans
          SET status = 'completed',
              risk_score = $2,
              summary = $3,
              completed_at = now()
          WHERE id = $1
        `,
        [scanId, review.risk_score, review.summary]
      );

      for (const finding of review.findings) {
        await client.query(
          `
            INSERT INTO vulnerabilities (
              scan_id, category, severity, title, file_path, line_start, line_end,
              evidence, recommendation, cwe, confidence
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            scanId,
            finding.category,
            finding.severity,
            finding.title,
            finding.file_path || null,
            finding.line_start || null,
            finding.line_end || null,
            finding.evidence || null,
            finding.recommendation,
            finding.cwe || null,
            finding.confidence
          ]
        );

        await client.query(
          `
            INSERT INTO vulnerability_trends (
              repository_id, trend_date, category, severity, finding_count
            )
            SELECT pr.repository_id, CURRENT_DATE, $2, $3, 1
            FROM scans s
            JOIN pull_requests pr ON pr.id = s.pull_request_id
            WHERE s.id = $1
            ON CONFLICT (repository_id, trend_date, category, severity)
            DO UPDATE SET finding_count = vulnerability_trends.finding_count + 1
          `,
          [scanId, finding.category, finding.severity]
        );
      }
    });

    await postPullRequestComment(owner, repo, event.pull_request.number, formatReviewComment(review));

    return { scanId, findings: review.findings.length, riskScore: review.risk_score };
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE scans
          SET status = 'failed',
              error_message = $2,
              completed_at = now()
          WHERE id = $1
        `,
        [scanId, error.message]
      );
    });
    throw error;
  }
}
