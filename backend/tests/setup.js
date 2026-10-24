import dotenv from 'dotenv';
import path from 'path';

process.env.NODE_ENV = 'test';

// Ensure .env.test is loaded
dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });

// Enforce Safety Guard
const dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.includes('neon.tech') || dbUrl.includes('ep-cold-scene')) {
  throw new Error(
    '❌ [SAFETY GUARD]: Test suite cannot run against shared/production Neon database! ' +
    'Configure a dedicated local test database in .env.test.'
  );
}
