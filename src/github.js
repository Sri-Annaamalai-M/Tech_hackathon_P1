import crypto from 'crypto';
import { config } from './config.js';

const githubApi = 'https://api.github.com';

export function verifyGitHubSignature(rawBody, signatureHeader) {
  if (!config.githubWebhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET is not configured');
  }

  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', config.githubWebhookSecret)
    .update(rawBody)
    .digest('hex')}`;

  const received = Buffer.from(signatureHeader, 'utf8');
  const calculated = Buffer.from(expected, 'utf8');

  return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
}

async function githubFetch(path, options = {}) {
  if (!config.githubToken) {
    throw new Error('GITHUB_TOKEN is not configured');
  }

  const response = await fetch(`${githubApi}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.githubToken}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'SentinelFlow',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function fetchPullRequestFiles(owner, repo, pullNumber) {
  const files = await githubFetch(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`);

  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch || ''
  }));
}

export async function postPullRequestComment(owner, repo, issueNumber, body) {
  return githubFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}
