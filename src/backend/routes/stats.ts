import { Router } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { getSSHSession, createSSHConnection, closeSSHConnection } from '../services/ssh.js';
import { Client } from 'ssh2';
import db from '../database/init.js';

const router = Router();

// Generate a unique session ID
const generateSessionId = () => {
  return `stats_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

interface ProcessInfo {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  command: string;
}

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
  processes: ProcessInfo[];
}

// Get current server stats (and save to DB)
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = getSSHSession(sessionId);

    if (!session || !session.isConnected) {
      return res.status(404).json({ success: false, error: 'Session not found or not connected' });
    }

    const stats = await collectServerStats(session.client);
    
    // Save stats to database
    saveStatsToDatabase(sessionId, session.connectionId, stats);
    
    res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function collectServerStats(client: Client): Promise<ServerStats> {
  const commands = {
    cpu: "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1",
    cores: "nproc",
    loadAvg: "cat /proc/loadavg",
    memInfo: "free -b | grep Mem",
    diskInfo: "df -B1 / | tail -1",
    uptime: "cat /proc/uptime | awk '{print $1}'",
    hostname: "hostname",
    os: "cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2",
    kernel: "uname -r",
    network: "ip -o addr show | awk '/inet / {print $2,$4}' | grep -v '127.0.0.1'",
    processes: "ps aux --sort=-%cpu | head -21 | tail -20",
  };

  const results: any = {};

  for (const [key, command] of Object.entries(commands)) {
    results[key] = await executeCommand(client, command);
  }

  // Parse CPU
  const cpuUsage = parseFloat(results.cpu.trim()) || 0;
  const cores = parseInt(results.cores.trim()) || 1;
  const loadAvgParts = results.loadAvg.trim().split(' ');
  const loadAvg = [
    parseFloat(loadAvgParts[0]) || 0,
    parseFloat(loadAvgParts[1]) || 0,
    parseFloat(loadAvgParts[2]) || 0,
  ];

  // Parse Memory
  const memParts = results.memInfo.trim().split(/\s+/);
  const memTotal = parseInt(memParts[1]) || 0;
  const memUsed = parseInt(memParts[2]) || 0;
  const memFree = parseInt(memParts[3]) || 0;
  const memUsagePercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

  // Parse Disk
  const diskParts = results.diskInfo.trim().split(/\s+/);
  const diskTotal = parseInt(diskParts[1]) || 0;
  const diskUsed = parseInt(diskParts[2]) || 0;
  const diskAvailable = parseInt(diskParts[3]) || 0;
  const diskUsagePercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

  // Parse Network
  const networkLines = results.network.trim().split('\n');
  const network = networkLines
    .filter((line: string) => line.trim())
    .map((line: string) => {
      const [name, ip] = line.trim().split(' ');
      return {
        name: name || 'unknown',
        ip: ip?.split('/')[0] || 'N/A',
        mac: 'N/A',
      };
    });

  // Parse Processes
  const processLines = results.processes.trim().split('\n');
  const processes = processLines
    .filter((line: string) => line.trim())
    .map((line: string): ProcessInfo | null => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) return null;

      return {
        pid: parts[1] || '',
        user: parts[0] || '',
        cpu: parts[2] || '0.0',
        mem: parts[3] || '0.0',
        command: parts.slice(10).join(' ') || '',
      };
    })
    .filter((p: ProcessInfo | null): p is ProcessInfo => p !== null);

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
    processes,
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

// Save stats to database
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

// Get historical stats for a session
router.get('/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const stmt = db.prepare(`
      SELECT * FROM server_stats 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `);

    const stats = stmt.all(sessionId, Number(limit), Number(offset));

    // Parse JSON fields
    const parsedStats = stats.map((stat: any) => ({
      ...stat,
      cpu_load_avg: JSON.parse(stat.cpu_load_avg),
      network_interfaces: JSON.parse(stat.network_interfaces),
    }));

    res.json({ success: true, data: parsedStats });
  } catch (error: any) {
    console.error('Failed to fetch historical stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get latest stats for a connection
router.get('/connection/:connectionId/latest', async (req, res) => {
  try {
    const { connectionId } = req.params;

    const stmt = db.prepare(`
      SELECT * FROM server_stats 
      WHERE connection_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `);

    const stat = stmt.get(Number(connectionId));

    if (!stat) {
      return res.status(404).json({ success: false, error: 'No stats found' });
    }

    // Parse JSON fields
    const parsedStat = {
      ...stat,
      cpu: {
        usage: (stat as any).cpu_usage,
        cores: (stat as any).cpu_cores,
        loadAvg: JSON.parse((stat as any).cpu_load_avg),
      },
      memory: {
        total: (stat as any).memory_total,
        used: (stat as any).memory_used,
        free: (stat as any).memory_free,
        usagePercent: (stat as any).memory_usage_percent,
      },
      disk: {
        total: (stat as any).disk_total,
        used: (stat as any).disk_used,
        available: (stat as any).disk_available,
        usagePercent: (stat as any).disk_usage_percent,
      },
      uptime: (stat as any).uptime,
      system: {
        hostname: (stat as any).hostname,
        os: (stat as any).os,
        kernel: (stat as any).kernel,
      },
      network: JSON.parse((stat as any).network_interfaces),
      timestamp: (stat as any).timestamp,
    };

    res.json({ success: true, data: parsedStat });
  } catch (error: any) {
    console.error('Failed to fetch latest stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Kill a process for a session
router.post('/:sessionId/kill-process', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { pid, signal = 'SIGTERM' } = req.body;

    if (!pid) {
      return res.status(400).json({ success: false, error: 'Process ID is required' });
    }

    const session = getSSHSession(sessionId);

    if (!session || !session.isConnected) {
      return res.status(404).json({ success: false, error: 'Session not found or not connected' });
    }

    // Validate signal
    const validSignals = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGQUIT'];
    if (!validSignals.includes(signal)) {
      return res.status(400).json({ success: false, error: 'Invalid signal' });
    }

    // Execute kill command
    const command = `kill -${signal.replace('SIG', '')} ${pid}`;
    await executeCommand(session.client, command);

    res.json({ success: true, message: 'Process terminated' });
  } catch (error: any) {
    console.error('Kill process error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to kill process' });
  }
});

// Fetch fresh stats for a connection (creates temporary session)
router.post('/connection/:connectionId/fetch', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { password } = req.body;
    const userId = (req as any).userId;

    // Get connection details
    const connStmt = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?');
    const connection = connStmt.get(Number(connectionId), userId) as any;

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    // Check if we have credentials
    const hasPassword = connection.password || password;
    if (!hasPassword && connection.auth_type === 'password') {
      return res.status(400).json({ success: false, error: 'Password required', needsPassword: true });
    }

    // Create temporary SSH session to fetch stats
    const sessionId = generateSessionId();
    const result = await createSSHConnection(sessionId, {
      connectionId: connection.id,
      userId,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: password || connection.password,
      privateKey: connection.private_key,
      passphrase: connection.passphrase,
    });

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Get the SSH session
    const sshSession = getSSHSession(sessionId);
    if (!sshSession || !sshSession.isConnected) {
      return res.status(500).json({ success: false, error: 'Failed to establish SSH connection' });
    }

    // Collect stats
    const stats = await collectServerStats(sshSession.client);

    // Save to database
    saveStatsToDatabase(sessionId, connection.id, stats);

    // Close temporary session
    closeSSHConnection(sessionId);

    res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('Failed to fetch stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
