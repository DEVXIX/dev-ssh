import path from 'path';

/**
 * Validates and sanitizes a hostname
 */
export function validateHostname(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') {
    return false;
  }

  // Allow IP addresses and domain names
  const hostnameRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

  return hostnameRegex.test(hostname) && hostname.length <= 253;
}

/**
 * Validates a port number
 */
export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

/**
 * Validates a username
 */
export function validateUsername(username: string): boolean {
  if (!username || typeof username !== 'string') {
    return false;
  }

  // Username: 3-32 characters, alphanumeric, underscore, hyphen, dot
  const usernameRegex = /^[a-zA-Z0-9._-]{3,32}$/;
  return usernameRegex.test(username);
}

/**
 * Validates password strength
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { valid: false, message: 'Password must be less than 128 characters' };
  }

  // Require at least one letter and one number
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one letter and one number' };
  }

  return { valid: true };
}

/**
 * Validates connection name
 */
export function validateConnectionName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // 1-64 characters, no special chars that could cause XSS
  return name.length >= 1 && name.length <= 64 && !/[<>]/.test(name);
}

/**
 * Prevents path traversal attacks
 * Returns normalized path or throws error if traversal detected
 */
export function validatePath(filePath: string, basePath?: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }

  // Normalize the path to remove .. and .
  const normalized = path.posix.normalize(filePath);

  // Check for path traversal attempts
  if (normalized.includes('..')) {
    throw new Error('Path traversal detected');
  }

  // Ensure absolute path
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;

  // If base path provided, ensure path is within base
  if (basePath) {
    const normalizedBase = path.posix.normalize(basePath);
    if (!absolutePath.startsWith(normalizedBase)) {
      throw new Error('Path outside allowed directory');
    }
  }

  return absolutePath;
}

/**
 * Validates file size limit (default 10MB)
 */
export function validateFileSize(size: number, maxSize: number = 10 * 1024 * 1024): boolean {
  return Number.isInteger(size) && size >= 0 && size <= maxSize;
}

/**
 * Sanitizes text input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .substring(0, 1000); // Limit length
}

/**
 * Validates session ID format
 */
export function validateSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  // Should be 32 hex characters (from crypto.randomBytes(16).toString('hex'))
  return /^[a-f0-9]{32}$/.test(sessionId);
}

/**
 * Validates SQL table name (for database operations)
 */
export function validateTableName(tableName: string): boolean {
  if (!tableName || typeof tableName !== 'string') {
    return false;
  }

  // Allow alphanumeric, underscores, 1-64 chars
  return /^[a-zA-Z0-9_]{1,64}$/.test(tableName);
}

/**
 * Validates database name
 */
export function validateDatabaseName(dbName: string): boolean {
  if (!dbName || typeof dbName !== 'string') {
    return false;
  }

  // Allow alphanumeric, underscores, hyphens, 1-64 chars
  return /^[a-zA-Z0-9_-]{1,64}$/.test(dbName);
}
