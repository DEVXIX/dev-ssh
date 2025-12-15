import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Security headers middleware
 * Adds various security headers to protect against common vulnerabilities
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Prevent clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection in browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Prevent browser from loading resources over insecure connections
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' data:;"
  );

  // Permissions Policy (formerly Feature-Policy)
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()'
  );

  next();
}

/**
 * CSRF protection middleware
 * Validates CSRF tokens for state-changing operations
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for GET, HEAD, OPTIONS (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for auth endpoints (they use their own protection)
  if (req.path.startsWith('/api/auth')) {
    return next();
  }

  // For API requests with JWT, the token itself provides CSRF protection
  // (as long as it's in Authorization header, not cookies)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // If no JWT in header, require CSRF token
  const csrfToken = req.headers['x-csrf-token'] as string;
  const sessionToken = (req.session as any)?.csrfToken;

  if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or missing CSRF token',
    });
  }

  next();
}

/**
 * Generate CSRF token for session
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sanitize error messages to prevent information disclosure
 */
export function sanitizeError(error: any): string {
  // In production, don't expose internal error details
  if (process.env.NODE_ENV === 'production') {
    // Map common errors to safe messages
    if (error.code === 'ECONNREFUSED') {
      return 'Unable to connect to remote server';
    }
    if (error.code === 'ETIMEDOUT') {
      return 'Connection timed out';
    }
    if (error.code === 'EAUTH') {
      return 'Authentication failed';
    }
    if (error.message && error.message.includes('password')) {
      return 'Authentication failed';
    }

    // Default safe message
    return 'An error occurred while processing your request';
  }

  // In development, show actual errors
  return error.message || 'Unknown error';
}

/**
 * Error handling middleware
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('[ERROR]', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  const statusCode = err.statusCode || 500;
  const message = sanitizeError(err);

  res.status(statusCode).json({
    success: false,
    error: message,
  });
}
