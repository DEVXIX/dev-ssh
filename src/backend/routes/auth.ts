import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDatabase } from '../database/init.js';
import { generateToken } from '../middleware/auth.js';
import rateLimiter from '../middleware/rateLimiter.js';
import { validateUsername, validatePassword } from '../utils/validation.js';

const router = Router();
const db = getDatabase();

// Register
router.post('/register', rateLimiter.authLimiter, async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    // Validate username
    if (!validateUsername(username)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3-32 characters and contain only letters, numbers, underscores, hyphens, or dots'
      });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, error: passwordValidation.message });
    }

    // Check if user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = db.prepare(
      'INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)'
    ).run(username, hashedPassword, isAdmin ? 1 : 0);

    const token = generateToken(Number(result.lastInsertRowid), username);

    res.json({
      success: true,
      data: {
        userId: result.lastInsertRowid,
        username,
        token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// Login
router.post('/login', rateLimiter.authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      rateLimiter.recordFailedAuth(req);
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    // Get user
    const user = db.prepare(
      'SELECT id, username, password, is_admin FROM users WHERE username = ?'
    ).get(username) as any;

    if (!user) {
      rateLimiter.recordFailedAuth(req);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      rateLimiter.recordFailedAuth(req);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Successful login - clear failed attempts
    rateLimiter.recordSuccessfulAuth(req);

    const token = generateToken(user.id, user.username);

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        isAdmin: user.is_admin === 1,
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Verify token
router.get('/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ success: true, data: decoded });
  } catch (error) {
    res.status(403).json({ success: false, error: 'Invalid token' });
  }
});

export default router;
