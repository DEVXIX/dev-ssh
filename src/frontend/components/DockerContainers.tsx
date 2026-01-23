import { Card } from './ui/card';
import { Play, Square, RotateCw, Trash2, Container, Eye } from 'lucide-react';
import { dockerAPI } from '../services/api';
import { useState, useEffect } from 'react';

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead';
  created: string;
  ports: string;
  uptime?: string;
}

interface DockerContainersProps {
  sessionId?: string;
  onRefresh?: () => void;
}

export function DockerContainers({ sessionId, onRefresh }: DockerContainersProps) {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(false);
  const [operatingId, setOperatingId] = useState<string | null>(null);
  const [dockerInstalled, setDockerInstalled] = useState(true);
  const [showDetails, setShowDetails] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId) {
      loadContainers();
      // Auto-refresh every 5 seconds
      const interval = setInterval(loadContainers, 5000);
      return () => clearInterval(interval);
    }
  }, [sessionId]);

  const loadContainers = async () => {
    if (!sessionId) return;

    try {
      setLoading(true);
      const response = await dockerAPI.listContainers(sessionId, true);
      setContainers(response.data.data || []);
      setDockerInstalled(true);
    } catch (error: any) {
      if (error.response?.data?.error?.includes('not installed')) {
        setDockerInstalled(false);
        setContainers([]);
      } else {
        console.error('Failed to load containers:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOperation = async (
    containerId: string,
    operation: 'start' | 'stop' | 'restart' | 'remove'
  ) => {
    if (!sessionId) return;

    if (operation === 'remove' && !confirm('Remove this container?')) return;

    setOperatingId(containerId);
    try {
      switch (operation) {
        case 'start':
          await dockerAPI.startContainer(sessionId, containerId);
          break;
        case 'stop':
          await dockerAPI.stopContainer(sessionId, containerId);
          break;
        case 'restart':
          await dockerAPI.restartContainer(sessionId, containerId);
          break;
        case 'remove':
          await dockerAPI.removeContainer(sessionId, containerId, false);
          break;
      }
      await loadContainers();
      if (onRefresh) onRefresh();
    } catch (error: any) {
      alert(error.response?.data?.error || `Failed to ${operation} container`);
    } finally {
      setOperatingId(null);
    }
  };

  if (!sessionId) return null;

  if (!dockerInstalled) {
    return (
      <Card className="p-3 bg-card/50">
        <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
          <Container className="h-3 w-3" />
          Docker Containers
        </h3>
        <p className="text-[10px] text-muted-foreground">Docker not installed on this server</p>
      </Card>
    );
  }

  if (containers.length === 0 && !loading) {
    return (
      <Card className="p-3 bg-card/50">
        <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
          <Container className="h-3 w-3" />
          Docker Containers
        </h3>
        <p className="text-[10px] text-muted-foreground">No containers found</p>
      </Card>
    );
  }

  return (
    <Card className="p-3 bg-card/50">
      <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Container className="h-3 w-3" />
        Docker Containers ({containers.length})
      </h3>
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
        {containers.map((container) => (
          <div key={container.id} className="group">
            <div className="flex items-center justify-between text-xs hover:bg-accent/30 rounded px-1.5 py-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    container.state === 'running'
                      ? 'bg-green-400'
                      : container.state === 'paused'
                      ? 'bg-yellow-400'
                      : container.state === 'restarting'
                      ? 'bg-blue-400 animate-pulse'
                      : 'bg-gray-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] truncate" title={container.name}>
                    {container.name}
                  </div>
                  <div className="text-[9px] text-muted-foreground truncate" title={container.image}>
                    {container.image}
                  </div>
                </div>
                {container.uptime && (
                  <span className="text-[9px] text-muted-foreground flex-shrink-0">
                    {container.uptime}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0">
                <button
                  onClick={() => setShowDetails(showDetails === container.id ? null : container.id)}
                  className="hover:text-blue-400 disabled:opacity-50"
                  title="Toggle details"
                >
                  <Eye className="h-3 w-3" />
                </button>
                {container.state === 'running' ? (
                  <>
                    <button
                      onClick={() => handleOperation(container.id, 'restart')}
                      disabled={operatingId === container.id}
                      className="hover:text-orange-400 disabled:opacity-50"
                      title="Restart"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleOperation(container.id, 'stop')}
                      disabled={operatingId === container.id}
                      className="hover:text-red-400 disabled:opacity-50"
                      title="Stop"
                    >
                      <Square className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleOperation(container.id, 'start')}
                      disabled={operatingId === container.id}
                      className="hover:text-green-400 disabled:opacity-50"
                      title="Start"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleOperation(container.id, 'remove')}
                      disabled={operatingId === container.id}
                      className="hover:text-red-400 disabled:opacity-50"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
            {showDetails === container.id && (
              <div className="ml-4 mt-1 p-2 bg-muted/30 rounded text-[9px] space-y-0.5">
                <div className="flex gap-2">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-mono">{container.id.substring(0, 12)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Status:</span>
                  <span>{container.status}</span>
                </div>
                {container.ports && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Ports:</span>
                    <span className="truncate" title={container.ports}>{container.ports || 'None'}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Created:</span>
                  <span>{container.created}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
