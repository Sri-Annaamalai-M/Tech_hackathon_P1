import 'dotenv/config';

const parseOrigins = (value) =>
  value
    ? value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN || '')
};
