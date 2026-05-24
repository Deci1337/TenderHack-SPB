import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('cli prints per-source counts in human output', async () => {
  const { stdout } = await execFileAsync('node', ['src/cli.js', 'айфон 15', '--limit', '1']);
  assert.match(stdout, /Per source: wildberries=\d+, ozon=\d+, yandex_market=\d+/);
  assert.match(stdout, /Offers: \d+/);
});

test('cli verbose output includes parsed cards before dedupe', async () => {
  const { stderr } = await execFileAsync('node', ['src/cli.js', 'айфон 15', '--limit', '1', '--verbose']);
  assert.match(stderr, /Parsed cards: \d+/);
  assert.match(stderr, /wildberries \|/);
  assert.match(stderr, /characteristics:/);
});
