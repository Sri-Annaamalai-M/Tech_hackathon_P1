import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000
    })
  : null;

export async function query(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }

  return pool.query(text, params);
}

export async function withTransaction(callback) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertRepository(client, repository) {
  const result = await client.query(
    `
      INSERT INTO repositories (
        github_repository_id, owner, name, full_name, default_branch, html_url, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (github_repository_id)
      DO UPDATE SET
        owner = EXCLUDED.owner,
        name = EXCLUDED.name,
        full_name = EXCLUDED.full_name,
        default_branch = EXCLUDED.default_branch,
        html_url = EXCLUDED.html_url,
        updated_at = now()
      RETURNING *
    `,
    [
      repository.id,
      repository.owner.login,
      repository.name,
      repository.full_name,
      repository.default_branch,
      repository.html_url
    ]
  );

  return result.rows[0];
}

export async function upsertPullRequest(client, repositoryId, pullRequest) {
  const result = await client.query(
    `
      INSERT INTO pull_requests (
        repository_id, github_pull_request_id, number, title, author_login,
        head_sha, base_sha, state, html_url, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (github_pull_request_id)
      DO UPDATE SET
        repository_id = EXCLUDED.repository_id,
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        author_login = EXCLUDED.author_login,
        head_sha = EXCLUDED.head_sha,
        base_sha = EXCLUDED.base_sha,
        state = EXCLUDED.state,
        html_url = EXCLUDED.html_url,
        updated_at = now()
      RETURNING *
    `,
    [
      repositoryId,
      pullRequest.id,
      pullRequest.number,
      pullRequest.title,
      pullRequest.user.login,
      pullRequest.head.sha,
      pullRequest.base.sha,
      pullRequest.state,
      pullRequest.html_url
    ]
  );

  return result.rows[0];
}
