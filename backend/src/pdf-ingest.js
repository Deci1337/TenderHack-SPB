#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseProcurementPdfFile } from './lib/pdf-ingest.js';

function parseArgs(argv) {
  const result = {
    files: [],
    out: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      result.out = argv[index + 1];
      index += 1;
      continue;
    }
    result.files.push(arg);
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.files.length === 0) {
    console.error('Usage: node src/pdf-ingest.js <file1.pdf> [file2.pdf ...] [--out output.json]');
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const file of args.files) {
    const parsed = await parseProcurementPdfFile(file);
    results.push(parsed);
  }

  const output = JSON.stringify(results.length === 1 ? results[0] : results, null, 2);

  if (args.out) {
    await writeFile(args.out, `${output}\n`, 'utf8');
  }

  process.stdout.write(`${output}\n`);
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
