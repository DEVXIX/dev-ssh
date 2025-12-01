import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { getJWTSecret } from '../middleware/auth.js';
import { getSSHSession } from '../services/ssh.js';
import { Client } from 'ssh2';
import db from '../database/init.js';

interface ServerStats {
  cpu: {
    usage: number;
    cores: number;
    loadAvg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
  uptime: number;
  system: {
    hostname: string;
    os: string;
    kernel: string;
  };
  network: Array<{
    name: string;
    ip: string;
    mac: string;
  }>;
}

export function handleStatsWebSocket(ws: WebSocket, req: IncomingMessage) {
  console.log('Stats WebSocket connection attempt');

  // Verify JWT token from query params
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.error('No token provided');
    ws.close(1008, 'No token provided');
    return;
  }

  try {
    jwt.verify(token, getJWTSecret());
    console.log('Stats WebSocket authenticated');
  } catch (error) {
    console.error('Invalid token:', error);
    ws.close(1008, 'Invalid token');
    return;
  }

  let statsInterval: NodeJS.Timeout | null = null;
  let currentSessionId: string | null = null;

  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Stats WebSocket message:', message.type);

      switch (message.type) {
        case 'start': {
          const { sessionId, interval = 5000 } = message.data;
          currentSessionId = sessionId;

          // Stop existing interval if any
          if (statsInterval) {
            clearInterval(statsInterval);
          }

          // Send initial stats
          await sendStats(ws, sessionId);

          // Start periodic stats updates
          statsInterval = setInterval(async () => {
            await sendStats(ws, sessionId);
          }, interval);

          ws.send(JSON.stringify({
            type: 'started',
            data: { interval },
          }));
          break;
        }

        case 'stop': {
          if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
          }
          currentSessionId = null;

          ws.send(JSON.stringify({
            type: 'stopped',
          }));
          break;
        }

        case 'refresh': {
          const { sessionId } = message.data;
          await sendStats(ws, sessionId);
          break;
        }
      }
    } catch (error) {
      console.error('Error handling stats WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  });

  ws.on('close', () => {
    console.log('Stats WebSocket closed');
    if (statsInterval) {
      clearInterval(statsInterval);
    }
  });

  ws.on('error', (error) => {
    console.error('Stats WebSocket error:', error);
  });
}

async function sendStats(ws: WebSocket, sessionId: string) {
  try {
    const session = getSSHSession(sessionId);

    if (!session || !session.isConnected) {
      ws.send(JSON.stringify({
        type: 'error',
        data: 'Session not found or not connected',
      }));
      return;
    }

    const stats = await collectServerStats(session.client);

    // Save to database
    saveStatsToDatabase(sessionId, session.connectionId, stats);

    // Send to client
    ws.send(JSON.stringify({
      type: 'stats',
      data: stats,
    }));
  } catch (error) {
    console.error('Failed to collect stats:', error);
    ws.send(JSON.stringify({
      type: 'error',
      data: error instanceof Error ? error.message : 'Failed to collect stats',
    }));
  }
}

async function collectServerStats(client: Client): Promise<ServerStats> {
  const commands = {
    cpuUsage: "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'",
    cpuCores: 'nproc',
    loadAvg: 'cat /proc/loadavg',
    memInfo: 'free -b | grep Mem',
    diskInfo: "df -B1 / | tail -1",
    uptime: "cat /proc/uptime | awk '{print $1}'",
    hostname: 'hostname',
    os: "cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'",
    kernel: 'uname -r',
    network: "ip -o addr show | awk '/inet / {print $2,$4}' && ip -o link show | awk '{print $2,$17}'",
  };

  const results: Record<string, string> = {};

  for (const [key, cmd] of Object.entries(commands)) {
    try {
      results[key] = await executeCommand(client, cmd);
    } catch (error) {
      console.error(`Failed to execute ${key}:`, error);
      results[key] = '';
    }
  }

  // Parse CPU
  const cpuUsage = parseFloat(results.cpuUsage) || 0;
  const cores = parseInt(results.cpuCores) || 1;
  const loadAvg = results.loadAvg.split(' ').slice(0, 3).map(parseFloat);

  // Parse memory
  const memParts = results.memInfo.trim().split(/\s+/);
  const memTotal = parseInt(memParts[1]) || 0;
  const memUsed = parseInt(memParts[2]) || 0;
  const memFree = parseInt(memParts[3]) || 0;
  const memUsagePercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  // Parse disk
  const diskParts = results.diskInfo.trim().split(/\s+/);
  const diskTotal = parseInt(diskParts[1]) || 0;
  const diskUsed = parseInt(diskParts[2]) || 0;
  const diskAvailable = parseInt(diskParts[3]) || 0;
  const diskUsagePercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

  // Parse network interfaces
  const networkLines = results.network.trim().split('\n');
  const network: Array<{ name: string; ip: string; mac: string }> = [];
  
  const ipMap = new Map<string, string>();
  const macMap = new Map<string, string>();

  for (const line of networkLines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const iface = parts[0].replace(':', '');
      if (parts[1].includes('.') || parts[1].includes(':')) {
        // IP address line
        ipMap.set(iface, parts[1].split('/')[0]);
      } else {
        // MAC address line
        macMap.set(iface, parts[1]);
      }
    }
  }

  for (const [iface, ip] of ipMap.entries()) {
    if (iface !== 'lo') {
      network.push({
        name: iface,
        ip,
        mac: macMap.get(iface) || '',
      });
    }
  }

  return {
    cpu: {
      usage: Math.round(cpuUsage),
      cores,
      loadAvg,
    },
    memory: {
      total: memTotal,
      used: memUsed,
      free: memFree,
      usagePercent: memUsagePercent,
    },
    disk: {
      total: diskTotal,
      used: diskUsed,
      available: diskAvailable,
      usagePercent: diskUsagePercent,
    },
    uptime: parseFloat(results.uptime.trim()) || 0,
    system: {
      hostname: results.hostname.trim() || 'unknown',
      os: results.os.trim() || 'Linux',
      kernel: results.kernel.trim() || 'unknown',
    },
    network,
  };
}

function executeCommand(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      let errorOutput = '';

      stream.on('data', (data: Buffer) => {
        output += data.toString();
      });

      stream.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      stream.on('close', () => {
        if (errorOutput) {
          console.error('Command stderr:', errorOutput);
        }
        resolve(output);
      });
    });
  });
}

function saveStatsToDatabase(sessionId: string, connectionId: number, stats: ServerStats) {
  try {
    const stmt = db.prepare(`
      INSERT INTO server_stats (
        session_id, connection_id, cpu_usage, cpu_cores, cpu_load_avg,
        memory_total, memory_used, memory_free, memory_usage_percent,
        disk_total, disk_used, disk_available, disk_usage_percent,
        uptime, hostname, os, kernel, network_interfaces
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      connectionId,
      stats.cpu.usage,
      stats.cpu.cores,
      JSON.stringify(stats.cpu.loadAvg),
      stats.memory.total,
      stats.memory.used,
      stats.memory.free,
      stats.memory.usagePercent,
      stats.disk.total,
      stats.disk.used,
      stats.disk.available,
      stats.disk.usagePercent,
      stats.uptime,
      stats.system.hostname,
      stats.system.os,
      stats.system.kernel,
      JSON.stringify(stats.network)
    );
  } catch (error) {
    console.error('Failed to save stats to database:', error);
  }
}
