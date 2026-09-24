import { z } from 'zod';
import { config } from './config.js';

const FindingSchema = z.object({
  category: z.string().min(1).max(80),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string().min(1).max(160),
  file_path: z.string().max(500).nullable().optional(),
  line_start: z.number().int().positive().nullable().optional(),
  line_end: z.number().int().positive().nullable().optional(),
  evidence: z.string().max(1200).nullable().optional(),
  recommendation: z.string().min(1).max(1600),
  cwe: z.string().max(40).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.7)
});

const ReviewSchema = z.object({
  summary: z.string().min(1).max(1200),
  risk_score: z.number().int().min(0).max(100),
  findings: z.array(FindingSchema).max(20)
});

const severityWeights = {
  critical: 35,
  high: 25,
  medium: 15,
  low: 7,
  info: 2
};

export function fallbackReview(files, reason = 'OpenAI review unavailable') {
  const riskyFiles = files.filter((file) =>
    /\.(js|ts|jsx|tsx|py|rb|php|java|go|sql)$/i.test(file.filename)
  );

  return {
    summary: `${reason}. SentinelFlow created an audit record and did not find validated AI findings in this fallback pass.`,
    risk_score: riskyFiles.length > 0 ? 10 : 0,
    findings: riskyFiles.length
      ? [
          {
            category: 'manual-review',
            severity: 'info',
            title: 'Manual security review recommended',
            file_path: riskyFiles[0].filename,
            line_start: null,
            line_end: null,
            evidence: 'The OpenAI analysis step was not completed.',
            recommendation:
              'Configure OPENAI_API_KEY and rerun the webhook to receive focused findings for SQL injection, dependency misuse, secret exposure, auth bypass, and unsafe data handling.',
            cwe: null,
            confidence: 0.4
          }
        ]
      : []
  };
}

function compactFiles(files) {
  return files
    .slice(0, 30)
    .map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch?.slice(0, 7000) || ''
    }));
}

export async function reviewPullRequest({ repository, pullRequest, files }) {
  if (!config.openaiApiKey) {
    return fallbackReview(files, 'OPENAI_API_KEY is not configured');
  }

  const prompt = {
    repository: repository.full_name,
    pull_request: {
      number: pullRequest.number,
      title: pullRequest.title,
      author: pullRequest.user.login,
      head_sha: pullRequest.head.sha
    },
    files: compactFiles(files)
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: 'system',
          content:
            'You are SentinelFlow, a focused application security reviewer. Return only valid JSON. Prioritize exploitable risks over style issues. Look for SQL injection, insecure dependency usage, auth/authorization flaws, secret exposure, command injection, SSRF, XSS, unsafe deserialization, path traversal, and insecure crypto. If evidence is weak, lower confidence or omit the finding.'
        },
        {
          role: 'user',
          content: `Review this pull request diff and return JSON with keys summary, risk_score, and findings. Each finding must include category, severity, title, file_path, line_start, line_end, evidence, recommendation, cwe, and confidence.\n\n${JSON.stringify(prompt)}`
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'sentinelflow_review',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'risk_score', 'findings'],
            properties: {
              summary: { type: 'string' },
              risk_score: { type: 'integer', minimum: 0, maximum: 100 },
              findings: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'category',
                    'severity',
                    'title',
                    'file_path',
                    'line_start',
                    'line_end',
                    'evidence',
                    'recommendation',
                    'cwe',
                    'confidence'
                  ],
                  properties: {
                    category: { type: 'string' },
                    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
                    title: { type: 'string' },
                    file_path: { type: ['string', 'null'] },
                    line_start: { type: ['integer', 'null'] },
                    line_end: { type: ['integer', 'null'] },
                    evidence: { type: ['string', 'null'] },
                    recommendation: { type: 'string' },
                    cwe: { type: ['string', 'null'] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                  }
                }
              }
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    return fallbackReview(files, `OpenAI API request failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.output_text ?? data.output?.[0]?.content?.[0]?.text;
  let reviewJson;

  try {
    reviewJson = JSON.parse(text);
  } catch {
    return fallbackReview(files, 'OpenAI response was not valid JSON');
  }

  const parsed = ReviewSchema.safeParse(reviewJson);

  if (!parsed.success) {
    return fallbackReview(files, 'OpenAI response did not match SentinelFlow review schema');
  }

  const weightedRisk = parsed.data.findings.reduce(
    (total, finding) => total + severityWeights[finding.severity] * finding.confidence,
    0
  );

  return {
    ...parsed.data,
    risk_score: Math.max(parsed.data.risk_score, Math.min(100, Math.round(weightedRisk)))
  };
}

export function formatReviewComment(review) {
  const lines = [
    '## SentinelFlow Security Review',
    '',
    `**Risk score:** ${review.risk_score}/100`,
    '',
    review.summary,
    ''
  ];

  if (!review.findings.length) {
    lines.push('No specific security findings were identified in this pass.');
    return lines.join('\n');
  }

  lines.push('| Severity | Finding | Location | Recommendation |');
  lines.push('| --- | --- | --- | --- |');

  for (const finding of review.findings) {
    const location = finding.file_path
      ? `${finding.file_path}${finding.line_start ? `:${finding.line_start}` : ''}`
      : 'PR diff';
    lines.push(
      `| ${finding.severity.toUpperCase()} | ${finding.title} | ${location} | ${finding.recommendation.replaceAll('\n', ' ')} |`
    );
  }

  lines.push('');
  lines.push('_Generated by SentinelFlow. Please validate AI findings before merging._');

  return lines.join('\n');
}
