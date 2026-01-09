/**
 * Database Migration Helper for RAPTOR
 *
 * Since Supabase requires migrations to be run through the Dashboard SQL Editor
 * or Supabase CLI, this script helps prepare and validate migrations.
 *
 * Usage:
 *   npm run migrate           # Show migration instructions
 *   npm run migrate:v22       # Show v2.2 upgrade migration SQL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Migrations directory
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Get all migration files from directory
 */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`❌ Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Show migration content
 */
function showMigration(filename: string): void {
  const filepath = path.join(MIGRATIONS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    console.error(`❌ Migration file not found: ${filename}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(filepath, 'utf-8');

  console.log('\n' + '='.repeat(80));
  console.log(`📄 Migration: ${filename}`);
  console.log('='.repeat(80) + '\n');
  console.log(sql);
  console.log('\n' + '='.repeat(80));
}

/**
 * Show instructions for running migrations
 */
function showInstructions(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    🦅 RAPTOR Database Migration Guide                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

There are 3 ways to run migrations on Supabase:

┌──────────────────────────────────────────────────────────────────────────────┐
│ Option 1: Supabase Dashboard (Recommended for quick updates)                 │
└──────────────────────────────────────────────────────────────────────────────┘

  1. Go to https://supabase.com/dashboard
  2. Select your project
  3. Navigate to: SQL Editor
  4. Copy the migration SQL and paste it
  5. Click "Run"

┌──────────────────────────────────────────────────────────────────────────────┐
│ Option 2: Supabase CLI (Recommended for production)                          │
└──────────────────────────────────────────────────────────────────────────────┘

  # Install Supabase CLI if not installed
  npm install -g supabase

  # Login to Supabase
  supabase login

  # Link to your project
  supabase link --project-ref YOUR_PROJECT_REF

  # Create migration (copies SQL file)
  supabase migration new v22_upgrade

  # Push migrations to remote
  supabase db push

┌──────────────────────────────────────────────────────────────────────────────┐
│ Option 3: Direct PostgreSQL Connection                                        │
└──────────────────────────────────────────────────────────────────────────────┘

  # Get connection string from Supabase Dashboard > Settings > Database
  psql "postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" \\
    -f packages/database/migrations/003_v22_upgrade.sql

`);
}

/**
 * Main function
 */
function main(): void {
  console.log('\n🚀 RAPTOR Database Migration Helper\n');
  console.log(`📁 Migrations directory: ${MIGRATIONS_DIR}`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const fileFilter = args.find((a) => a.startsWith('--file='))?.split('=')[1];

  // Get all migration files
  const files = getMigrationFiles();
  console.log(`📋 Found ${files.length} migration file(s):\n`);

  files.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f}`);
  });

  // If specific file requested, show it
  if (fileFilter) {
    const matchingFile = files.find((f) => f.includes(fileFilter));
    if (matchingFile) {
      showMigration(matchingFile);
      console.log('\n📋 Copy the SQL above and run it using one of the methods below:\n');
    } else {
      console.error(`\n❌ No migration file matching: ${fileFilter}`);
      process.exit(1);
    }
  }

  // Show instructions
  showInstructions();

  // Show v2.2 specific info
  const v22Migration = files.find((f) => f.includes('v22'));
  if (v22Migration && !fileFilter) {
    console.log(`
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🆕 v2.2 Upgrade Migration                                                    │
└──────────────────────────────────────────────────────────────────────────────┘

  To view the v2.2 migration SQL, run:

    cd packages/database && npm run migrate:v22

  This migration adds:
    ✓ Trading strategies (MICRO_SCALP, STANDARD, MOON_BAG, DCA_EXIT, TRAILING)
    ✓ Per-chain gas and slippage settings
    ✓ Blacklisted tokens and deployers tables
    ✓ Position tracking enhancements (peak price, trailing stop, partial exits)
    ✓ Token scores cache table
    ✓ Hunt settings per chain

`);
  }
}

// Run
main();
