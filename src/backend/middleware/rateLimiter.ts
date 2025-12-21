import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
  lockoutUntil?: number;
}

class RateLimiter {
  private attempts: Map<string, RateLimitRecord> = new Map();
  private lockouts: Map<string, number> = new Map();

  /**
   * Rate limiting middleware for authentication endpoints
   */
  authLimiter = (req: Request, res: Response, next: NextFunction) => {
    const identifier = this.getIdentifier(req);
    const now = Date.now();

    // Check if locked out
    const lockoutUntil = this.lockouts.get(identifier);
    if (lockoutUntil && now < lockoutUntil) {
      const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000);
      return res.status(429).json({
        success: false,
        error: `Account temporarily locked due to too many failed attempts. Try again in ${remainingSeconds} seconds.`,
      });
    }

    // Clean up expired lockout
    if (lockoutUntil && now >= lockoutUntil) {
      this.lockouts.delete(identifier);
      this.attempts.delete(identifier);
    }

    // Rate limit: 20 attempts per 15 minutes (relaxed for development)
    const record = this.attempts.get(identifier);
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxAttempts = 20;

    if (record && now < record.resetTime) {
      if (record.count >= maxAttempts) {
        // Lock out for 5 minutes after max failed attempts (reduced from 30)
        const lockoutDuration = 5 * 60 * 1000;
        this.lockouts.set(identifier, now + lockoutDuration);

        return res.status(429).json({
          success: false,
          error: 'Too many login attempts. Account locked for 5 minutes.',
        });
      }
    } else {
      // Reset window
      this.attempts.set(identifier, {
        count: 0,
        resetTime: now + windowMs,
      });
    }

    next();
  };

  /**
   * Record a failed authentication attempt
   */
  recordFailedAuth = (req: Request) => {
    const identifier = this.getIdentifier(req);
    const record = this.attempts.get(identifier);
    const now = Date.now();

    if (record && now < record.resetTime) {
      record.count++;
    } else {
      this.attempts.set(identifier, {
        count: 1,
        resetTime: now + 15 * 60 * 1000,
      });
    }
  };

  /**
   * Record a successful authentication (clears failed attempts)
   */
  recordSuccessfulAuth = (req: Request) => {
    const identifier = this.getIdentifier(req);
    this.attempts.delete(identifier);
    this.lockouts.delete(identifier);
  };

  /**
   * General rate limiter for API endpoints
   */
  apiLimiter = (requestsPerMinute: number = 60) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const identifier = this.getIdentifier(req);
      const now = Date.now();
      const windowMs = 60 * 1000; // 1 minute

      const record = this.attempts.get(`api:${identifier}`);

      if (record && now < record.resetTime) {
        if (record.count >= requestsPerMinute) {
          return res.status(429).json({
            success: false,
            error: 'Too many requests. Please slow down.',
          });
        }
        record.count++;
      } else {
        this.attempts.set(`api:${identifier}`, {
          count: 1,
          resetTime: now + windowMs,
        });
      }

      next();
    };
  };

  /**
   * Get unique identifier for the request (IP + User-Agent)
   */
  private getIdentifier(req: Request): string {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return `${ip}:${userAgent}`;
  }

  /**
   * Cleanup expired records (run periodically)
   */
  cleanup = () => {
    const now = Date.now();

    // Clean up expired attempts
    for (const [key, record] of this.attempts.entries()) {
      if (now >= record.resetTime) {
        this.attempts.delete(key);
      }
    }

    // Clean up expired lockouts
    for (const [key, lockoutTime] of this.lockouts.entries()) {
      if (now >= lockoutTime) {
        this.lockouts.delete(key);
      }
    }
  };
}

// Create singleton instance
const rateLimiter = new RateLimiter();

// Run cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

export default rateLimiter;
