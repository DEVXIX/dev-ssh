#!/usr/bin/env node
/**
 * Migration script to encrypt existing plaintext credentials in the database
 *
 * This script:
 * 1. Reads all connections from the database
 * 2. Encrypts any plaintext passwords, private keys, and passphrases
 * 3. Updates the database with encrypted values
 *
 * IMPORTANT: Run this script ONCE after setting up ENCRYPTION_KEY in .env
 *
 * Usage: node dist/backend/scripts/encrypt-credentials.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { encrypt, isEncrypted } from '../utils/encryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Get database path
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../../data/database.db');

console.log('='.repeat(70));
console.log('CREDENTIAL ENCRYPTION MIGRATION SCRIPT');
console.log('='.repeat(70));
console.log();

// Check if encryption key is set
if (!process.env.ENCRYPTION_KEY) {
  console.error('❌ ERROR: ENCRYPTION_KEY not set in .env file');
  console.error('');
  console.error('Please generate a secure encryption key:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('');
  console.error('Then add it to your .env file:');
  console.error('  ENCRYPTION_KEY=<your_generated_key>');
  console.error('');
  process.exit(1);
}

console.log('✓ Encryption key found');
console.log(`✓ Database path: ${dbPath}`);
console.log();

// Open database
const db = new Database(dbPath);

try {
  // Get all connections
  const connections = db.prepare('SELECT * FROM connections').all() as any[];

  console.log(`Found ${connections.length} connection(s) in database`);
  console.log();

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const conn of connections) {
    console.log(`Processing connection ID ${conn.id}: "${conn.name}" (${conn.type})`);

    let needsUpdate = false;
    const updates: { password?: string | null; private_key?: string | null; passphrase?: string | null } = {};

    // Check and encrypt password
    if (conn.password && !isEncrypted(conn.password)) {
      console.log('  → Encrypting password...');
      try {
        updates.password = encrypt(conn.password);
        needsUpdate = true;
      } catch (error: any) {
        console.error(`  ❌ Failed to encrypt password: ${error.message}`);
        errorCount++;
        continue;
      }
    } else if (conn.password) {
      console.log('  ✓ Password already encrypted');
    }

    // Check and encrypt private key
    if (conn.private_key && !isEncrypted(conn.private_key)) {
      console.log('  → Encrypting private key...');
      try {
        updates.private_key = encrypt(conn.private_key);
        needsUpdate = true;
      } catch (error: any) {
        console.error(`  ❌ Failed to encrypt private key: ${error.message}`);
        errorCount++;
        continue;
      }
    } else if (conn.private_key) {
      console.log('  ✓ Private key already encrypted');
    }

    // Check and encrypt passphrase
    if (conn.passphrase && !isEncrypted(conn.passphrase)) {
      console.log('  → Encrypting passphrase...');
      try {
        updates.passphrase = encrypt(conn.passphrase);
        needsUpdate = true;
      } catch (error: any) {
        console.error(`  ❌ Failed to encrypt passphrase: ${error.message}`);
        errorCount++;
        continue;
      }
    } else if (conn.passphrase) {
      console.log('  ✓ Passphrase already encrypted');
    }

    if (needsUpdate) {
      // Update the database
      const fields: string[] = [];
      const values: any[] = [];

      if ('password' in updates) {
        fields.push('password = ?');
        values.push(updates.password);
      }
      if ('private_key' in updates) {
        fields.push('private_key = ?');
        values.push(updates.private_key);
      }
      if ('passphrase' in updates) {
        fields.push('passphrase = ?');
        values.push(updates.passphrase);
      }

      values.push(conn.id);

      const query = `UPDATE connections SET ${fields.join(', ')} WHERE id = ?`;
      db.prepare(query).run(...values);

      console.log('  ✅ Updated successfully');
      updatedCount++;
    } else {
      console.log('  ⏭️  No changes needed');
      skippedCount++;
    }

    console.log();
  }

  console.log('='.repeat(70));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total connections: ${connections.length}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped (already encrypted): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log();

  if (updatedCount > 0) {
    console.log('✅ Credentials have been encrypted successfully!');
    console.log('');
    console.log('⚠️  IMPORTANT: Keep your ENCRYPTION_KEY safe!');
    console.log('   - Back up your .env file securely');
    console.log('   - Never change the ENCRYPTION_KEY or you won\'t be able to decrypt existing data');
    console.log('   - Keep the key secret - anyone with access can decrypt all credentials');
  } else {
    console.log('✅ All credentials are already encrypted!');
  }

  console.log();

} catch (error: any) {
  console.error('❌ MIGRATION FAILED:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  db.close();
}
