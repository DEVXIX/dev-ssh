import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import connectionRoutes from './routes/connections.js';
import fileRoutes from './routes/files.js';
import tunnelRoutes from './routes/tunnels.js';
import statsRoutes from './routes/stats.js';
import workspaceRoutes from './routes/workspaces.js';
import databaseRoutes from './routes/database.js';
import { initDatabase } from './database/init.js';
import { handleTerminalWebSocket } from './websocket/terminal.js';
import { handleStatsWebSocket } from './websocket/stats.js';
import { authenticateToken } from './middleware/auth.js';
import { securityHeaders, errorHandler } from './middleware/security.js';
import rateLimiter from './middleware/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Security headers middleware (apply first)
app.use(securityHeaders);

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Initialize database
initDatabase();

// Routes - Rate limits are per minute (significantly relaxed for development)
app.use('/api/auth', authRoutes);
app.use('/api/connections', authenticateToken, rateLimiter.apiLimiter(300), connectionRoutes);
app.use('/api/files', authenticateToken, rateLimiter.apiLimiter(500), fileRoutes);
app.use('/api/tunnels', authenticateToken, rateLimiter.apiLimiter(300), tunnelRoutes);
app.use('/api/stats', authenticateToken, rateLimiter.apiLimiter(500), statsRoutes);
app.use('/api/workspaces', authenticateToken, rateLimiter.apiLimiter(300), workspaceRoutes);
app.use('/api/database', authenticateToken, rateLimiter.apiLimiter(1000), databaseRoutes);

// Health check (no authentication required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Create HTTP server
const server = createServer(app);

// Single WebSocket server for both terminal and stats
const wss = new WebSocketServer({ 
  server,
  clientTracking: true
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;
  
  console.log(`WebSocket connection to path: ${pathname}`);
  
  if (pathname === '/ws/terminal') {
    console.log('Routing to terminal WebSocket handler');
    handleTerminalWebSocket(ws, req);
  } else if (pathname === '/ws/stats') {
    console.log('Routing to stats WebSocket handler');
    handleStatsWebSocket(ws, req);
  } else {
    console.log(`Unknown WebSocket path: ${pathname}, closing connection`);
    ws.close(1008, 'Unknown path');
  }
});

wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

server.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`);
  console.log(`[WEBSOCKET] Terminal WebSocket ready on ws://localhost:${PORT}/ws/terminal`);
  console.log(`[WEBSOCKET] Stats WebSocket ready on ws://localhost:${PORT}/ws/stats`);
});

export default app;
