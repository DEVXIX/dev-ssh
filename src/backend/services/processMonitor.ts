import { executeSSHCommand } from './ssh.js';

export interface ProcessInfo {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  vsz: string;
  rss: string;
  tty: string;
  stat: string;
  start: string;
  time: string;
  command: string;
}

export interface SystemStats {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  uptime: string;
  loadAverage: string;
}

/**
 * Get list of running processes
 */
export async function getProcesses(
  connectionId: number,
  userId: number
): Promise<{ success: boolean; processes?: ProcessInfo[]; error?: string }> {
  try {
    // Use ps command to get process list
    // aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
    const result = await executeSSHCommand(
      connectionId,
      userId,
      'ps aux --sort=-%cpu | head -100'
    );

    if (!result.success || !result.output) {
      return { success: false, error: result.error || 'No output' };
    }

    const lines = result.output.trim().split('\n');
    if (lines.length < 2) {
      return { success: true, processes: [] };
    }

    // Skip header line
    const processes: ProcessInfo[] = lines.slice(1).map(line => {
      // Split by whitespace, but preserve command with spaces
      const parts = line.trim().split(/\s+/);

      return {
        user: parts[0] || '',
        pid: parts[1] || '',
        cpu: parts[2] || '0',
        mem: parts[3] || '0',
        vsz: parts[4] || '0',
        rss: parts[5] || '0',
        tty: parts[6] || '?',
        stat: parts[7] || '',
        start: parts[8] || '',
        time: parts[9] || '',
        command: parts.slice(10).join(' ') || '',
      };
    }).filter(p => p.pid); // Filter out any malformed entries

    return { success: true, processes };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get system statistics
 */
export async function getSystemStats(
  connectionId: number,
  userId: number
): Promise<{ success: boolean; stats?: SystemStats; error?: string }> {
  try {
    // Get CPU info
    const cpuResult = await executeSSHCommand(
      connectionId,
      userId,
      'nproc && top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\''
    );

    // Get memory info
    const memResult = await executeSSHCommand(
      connectionId,
      userId,
      'free -m | grep Mem | awk \'{print $2,$3,$4}\''
    );

    // Get uptime and load average
    const uptimeResult = await executeSSHCommand(
      connectionId,
      userId,
      'uptime | awk -F\'up\' \'{print $2}\' | awk -F\',\' \'{print $1}\' && uptime | awk -F\'load average:\' \'{print $2}\''
    );

    if (!cpuResult.success || !memResult.success || !uptimeResult.success) {
      return { success: false, error: 'Failed to get system stats' };
    }

    // Parse CPU info
    const cpuLines = (cpuResult.output || '').trim().split('\n');
    const cores = parseInt(cpuLines[0]) || 1;
    const cpuUsage = parseFloat(cpuLines[1]) || 0;

    // Parse memory info
    const memParts = (memResult.output || '').trim().split(/\s+/);
    const memTotal = parseInt(memParts[0]) || 1;
    const memUsed = parseInt(memParts[1]) || 0;
    const memFree = parseInt(memParts[2]) || 0;
    const memPercentage = (memUsed / memTotal) * 100;

    // Parse uptime
    const uptimeLines = (uptimeResult.output || '').trim().split('\n');
    const uptime = uptimeLines[0]?.trim() || 'Unknown';
    const loadAverage = uptimeLines[1]?.trim() || 'Unknown';

    return {
      success: true,
      stats: {
        cpu: {
          usage: Math.round(cpuUsage * 10) / 10,
          cores,
        },
        memory: {
          total: memTotal,
          used: memUsed,
          free: memFree,
          percentage: Math.round(memPercentage * 10) / 10,
        },
        uptime,
        loadAverage,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Kill a process
 */
export async function killProcess(
  connectionId: number,
  userId: number,
  pid: string,
  signal: string = 'TERM'
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await executeSSHCommand(
      connectionId,
      userId,
      `kill -${signal} ${pid}`
    );

    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Search processes by name
 */
export async function searchProcesses(
  connectionId: number,
  userId: number,
  query: string
): Promise<{ success: boolean; processes?: ProcessInfo[]; error?: string }> {
  try {
    const result = await executeSSHCommand(
      connectionId,
      userId,
      `ps aux | grep -i "${query}" | grep -v grep`
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    if (!result.output || result.output.trim() === '') {
      return { success: true, processes: [] };
    }

    const lines = result.output.trim().split('\n');
    const processes: ProcessInfo[] = lines.map(line => {
      const parts = line.trim().split(/\s+/);

      return {
        user: parts[0] || '',
        pid: parts[1] || '',
        cpu: parts[2] || '0',
        mem: parts[3] || '0',
        vsz: parts[4] || '0',
        rss: parts[5] || '0',
        tty: parts[6] || '?',
        stat: parts[7] || '',
        start: parts[8] || '',
        time: parts[9] || '',
        command: parts.slice(10).join(' ') || '',
      };
    }).filter(p => p.pid);

    return { success: true, processes };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
