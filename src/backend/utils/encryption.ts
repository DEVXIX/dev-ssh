import crypto from 'crypto';

// Get encryption key from environment or generate one
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    console.warn('[SECURITY WARNING] ENCRYPTION_KEY not set in .env - using fallback (NOT SECURE FOR PRODUCTION)');
    console.warn('[SECURITY WARNING] Generate a secure key with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
    // Use a deterministic but weak key as fallback
    return crypto.scryptSync('default-insecure-key', 'salt', 32);
  }

  // Convert hex string to buffer
  const keyBuffer = Buffer.from(key, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
  }

  return keyBuffer;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts sensitive data using AES-256-GCM
 * @param plaintext - The data to encrypt
 * @returns Base64 encoded encrypted data with IV and auth tag
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) {
    return null;
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combine IV + authTag + encrypted data
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'base64')
    ]);

    return combined.toString('base64');
  } catch (error) {
    console.error('[ENCRYPTION ERROR]', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts data encrypted with encrypt()
 * @param ciphertext - Base64 encoded encrypted data
 * @returns Decrypted plaintext
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) {
    return null;
  }

  try {
    const combined = Buffer.from(ciphertext, 'base64');

    // Extract IV, auth tag, and encrypted data
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('[DECRYPTION ERROR]', error);
    throw new Error('Failed to decrypt data - data may be corrupted or key may be incorrect');
  }
}

/**
 * Checks if a string appears to be encrypted (base64 with sufficient length)
 * @param value - Value to check
 * @returns true if value appears encrypted
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const buffer = Buffer.from(value, 'base64');
    // Encrypted data should be at least IV + AuthTag length
    return buffer.length >= (IV_LENGTH + AUTH_TAG_LENGTH);
  } catch {
    return false;
  }
}
