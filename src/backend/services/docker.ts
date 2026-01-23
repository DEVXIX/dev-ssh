import { Client } from 'ssh2';
import { getSSHSession } from './ssh.js';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead';
  created: string;
  ports: string;
  uptime?: string;
}

export interface DockerStats {
  containerId: string;
  name: string;
  cpu: string;
  memory: string;
  memoryLimit: string;
  memoryPercent: string;
  netIO: string;
  blockIO: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
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

      stream.on('close', (code: number) => {
        if (code !== 0 && errorOutput) {
          reject(new Error(errorOutput));
        } else {
          resolve(output);
        }
      });
    });
  });
}

export async function listContainers(sessionId: string, all = true): Promise<DockerContainer[]> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const flag = all ? '-a' : '';
  const command = `docker ps ${flag} --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.CreatedAt}}|{{.Ports}}"`;

  try {
    const output = await executeCommand(session.client, command);

    if (!output.trim()) {
      return [];
    }

    const lines = output.trim().split('\n');
    return lines.map(line => {
      const [id, name, image, status, state, created, ports] = line.split('|');

      // Extract uptime from status if running
      let uptime: string | undefined;
      if (state === 'running' && status.includes('Up')) {
        const uptimeMatch = status.match(/Up\s+(.+?)(?:\s+\(|$)/);
        if (uptimeMatch) {
          uptime = uptimeMatch[1];
        }
      }

      return {
        id: id || '',
        name: name || '',
        image: image || '',
        status: status || '',
        state: (state as DockerContainer['state']) || 'exited',
        created: created || '',
        ports: ports || '',
        uptime,
      };
    });
  } catch (error: any) {
    if (error.message.includes('command not found') || error.message.includes('docker: not found')) {
      throw new Error('Docker is not installed on this server');
    }
    throw error;
  }
}

export async function getContainerStats(sessionId: string, containerId?: string): Promise<DockerStats[]> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const target = containerId || '';
  const command = `docker stats ${target} --no-stream --format "{{.Container}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}"`;

  const output = await executeCommand(session.client, command);

  if (!output.trim()) {
    return [];
  }

  const lines = output.trim().split('\n');
  return lines.map(line => {
    const [id, name, cpu, memUsage, memPercent, netIO, blockIO] = line.split('|');

    // Parse memory usage (e.g., "100MiB / 2GiB")
    const memParts = memUsage?.split('/') || ['0', '0'];
    const memory = memParts[0]?.trim() || '0';
    const memoryLimit = memParts[1]?.trim() || '0';

    return {
      containerId: id || '',
      name: name || '',
      cpu: cpu || '0%',
      memory,
      memoryLimit,
      memoryPercent: memPercent || '0%',
      netIO: netIO || '0B / 0B',
      blockIO: blockIO || '0B / 0B',
    };
  });
}

export async function startContainer(sessionId: string, containerId: string): Promise<void> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  await executeCommand(session.client, `docker start ${containerId}`);
}

export async function stopContainer(sessionId: string, containerId: string): Promise<void> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  await executeCommand(session.client, `docker stop ${containerId}`);
}

export async function restartContainer(sessionId: string, containerId: string): Promise<void> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  await executeCommand(session.client, `docker restart ${containerId}`);
}

export async function removeContainer(sessionId: string, containerId: string, force = false): Promise<void> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const flag = force ? '-f' : '';
  await executeCommand(session.client, `docker rm ${flag} ${containerId}`);
}

export async function getContainerLogs(
  sessionId: string,
  containerId: string,
  tail = 100,
  follow = false
): Promise<string> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const followFlag = follow ? '-f' : '';
  const command = `docker logs ${followFlag} --tail ${tail} ${containerId}`;

  return await executeCommand(session.client, command);
}

export async function execInContainer(
  sessionId: string,
  containerId: string,
  command: string
): Promise<string> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const dockerCommand = `docker exec ${containerId} ${command}`;
  return await executeCommand(session.client, dockerCommand);
}

export async function inspectContainer(sessionId: string, containerId: string): Promise<any> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const output = await executeCommand(session.client, `docker inspect ${containerId}`);
  return JSON.parse(output);
}

export async function listImages(sessionId: string): Promise<DockerImage[]> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const command = 'docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}"';
  const output = await executeCommand(session.client, command);

  if (!output.trim()) {
    return [];
  }

  const lines = output.trim().split('\n');
  return lines.map(line => {
    const [id, repository, tag, size, created] = line.split('|');
    return {
      id: id || '',
      repository: repository || '',
      tag: tag || '',
      size: size || '',
      created: created || '',
    };
  });
}

export async function pullImage(sessionId: string, imageName: string): Promise<string> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  return await executeCommand(session.client, `docker pull ${imageName}`);
}

export async function removeImage(sessionId: string, imageId: string, force = false): Promise<void> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('Session not found or not connected');
  }

  const flag = force ? '-f' : '';
  await executeCommand(session.client, `docker rmi ${flag} ${imageId}`);
}

export async function checkDockerInstalled(sessionId: string): Promise<boolean> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    return false;
  }

  try {
    await executeCommand(session.client, 'docker --version');
    return true;
  } catch {
    return false;
  }
}
