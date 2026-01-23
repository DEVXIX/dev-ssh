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
import storageRoutes from './routes/storage.js';
import rdpRoutes from './routes/rdp.js';
import tasksRoutes from './routes/tasks.js';
import processMonitorRoutes from './routes/processMonitor.js';
import { initDatabase } from './database/init.js';
import { handleTerminalWebSocket } from './websocket/terminal.js';
import { handleStatsWebSocket } from './websocket/stats.js';
import { handleRDPGuacWebSocket } from './websocket/rdp-guac.js';
import { authenticateToken } from './middleware/auth.js';
import { securityHeaders, errorHandler } from './middleware/security.js';
import rateLimiter from './middleware/rateLimiter.js';
import { initTaskScheduler, stopAllTasks } from './services/taskScheduler.js';

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
app.use('/api/database', authenticateToken, rateLimiter.apiLimiter(7777), databaseRoutes);
app.use('/api/storage', authenticateToken, rateLimiter.apiLimiter(500), storageRoutes);
app.use('/api/rdp', authenticateToken, rateLimiter.apiLimiter(300), rdpRoutes);
app.use('/api/tasks', authenticateToken, rateLimiter.apiLimiter(300), tasksRoutes);
app.use('/api/process-monitor', authenticateToken, rateLimiter.apiLimiter(500), processMonitorRoutes);

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
  clientTracking: true,
  // Handle WebSocket subprotocol for Guacamole
  handleProtocols: (protocols, req) => {
    // If 'guacamole' protocol is requested (by guacamole-common-js), accept it
    if (protocols.has('guacamole')) {
      return 'guacamole';
    }
    // For other WebSocket connections (terminal, stats), accept without subprotocol
    return false;
  }
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;
  const protocol = ws.protocol;

  console.log(`WebSocket connection to path: ${pathname}, protocol: ${protocol || 'none'}`);
  
  if (pathname === '/ws/terminal') {
    console.log('Routing to terminal WebSocket handler');
    handleTerminalWebSocket(ws, req);
  } else if (pathname === '/ws/stats') {
    console.log('Routing to stats WebSocket handler');
    handleStatsWebSocket(ws, req);
  } else if (pathname === '/ws/rdp') {
    console.log('Routing to RDP WebSocket handler (Guacamole)');
    handleRDPGuacWebSocket(ws, req);
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
  console.log(`[WEBSOCKET] RDP WebSocket ready on ws://localhost:${PORT}/ws/rdp`);

  // Initialize task scheduler after server is ready
  initTaskScheduler();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM signal received, shutting down gracefully...');
  stopAllTasks();
  server.close(() => {
    console.log('[SERVER] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT signal received, shutting down gracefully...');
  stopAllTasks();
  server.close(() => {
    console.log('[SERVER] HTTP server closed');
    process.exit(0);
  });
});

export default app;
