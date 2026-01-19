import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';

let idlCache: { idl: Idl; coder: BorshAccountsCoder; path: string } | null = null;

const CANDIDATE_PATHS = [
  'idl/pump.json',
  'idls/pump.json',
  'src/idl/pump.json',
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.pnpm',
  'dist',
  'build',
  'target',
]);

const MAX_SCAN_DEPTH = 6;

function findRepoRoot(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    const normalized = path.resolve(p);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function scoreIdlPath(filePath: string): number {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'pump.json') return 0;
  if (base.startsWith('pump') && base.endsWith('.json')) return 1;
  return 2;
}

function scanForIdlCandidates(rootDir: string): string[] {
  const candidates: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > MAX_SCAN_DEPTH) return;

    const dirName = path.basename(dir);
    if (SKIP_DIRS.has(dirName)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      const lowerName = entry.name.toLowerCase();
      if (!lowerName.endsWith('.json')) continue;
      if (!lowerName.startsWith('pump')) continue;
      if (!dir.toLowerCase().includes(path.sep + 'idl')) continue;

      candidates.push(fullPath);
    }
  }

  walk(rootDir, 0);
  return candidates;
}

export function locatePumpIdlPath(): string {
  const envPath = process.env.PUMP_IDL_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return path.resolve(envPath);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot =
    findRepoRoot(process.cwd()) ||
    findRepoRoot(moduleDir) ||
    process.cwd();

  for (const rel of CANDIDATE_PATHS) {
    const candidate = path.join(repoRoot, rel);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const searchRoots = uniquePaths([
    path.join(repoRoot, 'packages'),
    path.join(repoRoot, 'vendor'),
    path.join(repoRoot, 'idl'),
    path.join(repoRoot, 'idls'),
    path.join(repoRoot, 'src'),
  ]);

  const matches: string[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      matches.push(...scanForIdlCandidates(root));
    }
  }

  if (matches.length === 0) {
    throw new Error(
      'Pump IDL not found. Expected in ./idl/pump.json, ./idls/pump.json, ./src/idl/pump.json, ' +
      './packages/**/idl/pump*.json, or ./vendor/pump-public-docs/**/idl*.json. ' +
      'Set PUMP_IDL_PATH to override.'
    );
  }

  matches.sort((a, b) => scoreIdlPath(a) - scoreIdlPath(b));
  return matches[0];
}

export function loadPumpIdl(): { idl: Idl; coder: BorshAccountsCoder; path: string } {
  if (idlCache) {
    return idlCache;
  }

  const idlPath = locatePumpIdlPath();
  const raw = fs.readFileSync(idlPath, 'utf8');
  const parsed = JSON.parse(raw) as Idl;

  if (!parsed.accounts || !Array.isArray(parsed.accounts)) {
    throw new Error(`Invalid Pump IDL at ${idlPath}: missing accounts`);
  }

  const coder = new BorshAccountsCoder(parsed);
  idlCache = { idl: parsed, coder, path: idlPath };
  return idlCache;
}
