import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function getJWTSecret() {
  return process.env.JWT_SECRET || 'your-secret-key';
}

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, getJWTSecret()) as { userId: number; username: string };
    (req as AuthRequest).userId = decoded.userId;
    (req as AuthRequest).username = decoded.username;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function generateToken(userId: number, username: string): string {
  const secret = getJWTSecret();
  console.log('Generating token with JWT_SECRET:', secret);
  return jwt.sign({ userId, username }, secret, { expiresIn: '7d' });
}
