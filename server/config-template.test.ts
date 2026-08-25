import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readExampleEnvironment(): Map<string, string> {
  const content = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return values;
}

test('.env.example 默认可安全用于本地开发', () => {
  const values = readExampleEnvironment();
  assert.equal(values.get('APP_ENV'), 'development');
  assert.equal(values.get('APP_URL'), 'http://localhost:5173/today');
  assert.equal(values.get('TRUST_PROXY_HOPS'), '0');
  assert.equal(values.get('BACKGROUND_JOBS_ENABLED'), 'false');
});
