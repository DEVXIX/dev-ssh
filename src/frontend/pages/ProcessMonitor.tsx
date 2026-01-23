import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { processMonitorAPI, connectionsAPI } from '../services/api';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  XCircle,
  Cpu,
  MemoryStick,
  Clock,
  Activity,
  AlertCircle,
} from 'lucide-react';

interface ProcessInfo {
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

interface SystemStats {
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

export default function ProcessMonitor() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const [connection, setConnection] = useState<any>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadConnection();
  }, [connectionId]);

  useEffect(() => {
    if (connection) {
      loadData();
    }
  }, [connection]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadData(true);
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, connection]);

  const loadConnection = async () => {
    try {
      const response = await connectionsAPI.getOne(connectionId!);
      if (response.data.success) {
        setConnection(response.data.data);
      }
    } catch (error: any) {
      setError('Failed to load connection');
    }
  };

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    setError('');

    try {
      const [processesRes, statsRes] = await Promise.all([
        processMonitorAPI.getProcesses(parseInt(connectionId!)),
        processMonitorAPI.getSystemStats(parseInt(connectionId!)),
      ]);

      if (processesRes.data.success) {
        setProcesses(processesRes.data.processes || []);
      }

      if (statsRes.data.success) {
        setStats(statsRes.data.stats);
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to load process data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadData();
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await processMonitorAPI.searchProcesses(
        parseInt(connectionId!),
        searchQuery
      );

      if (response.data.success) {
        setProcesses(response.data.processes || []);
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to search processes');
    } finally {
      setLoading(false);
    }
  };

  const handleKillProcess = async (pid: string, processName: string) => {
    if (!confirm(`Are you sure you want to kill process ${pid} (${processName})?`)) {
      return;
    }

    try {
      await processMonitorAPI.killProcess(parseInt(connectionId!), pid);
      loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to kill process');
    }
  };

  if (loading && !refreshing) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading processes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => navigate('/connections')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold mb-1">Process Monitor</h1>
            <p className="text-muted-foreground">
              {connection?.name} ({connection?.host})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-primary/10' : ''}
          >
            <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-pulse' : ''}`} />
            Auto Refresh
          </Button>
          <Button onClick={() => loadData()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 mb-6 border-destructive">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {/* System Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Cpu className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">CPU Usage</p>
                <p className="text-2xl font-bold">{stats.cpu.usage}%</p>
                <p className="text-xs text-muted-foreground">{stats.cpu.cores} cores</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <MemoryStick className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Memory</p>
                <p className="text-2xl font-bold">{stats.memory.percentage}%</p>
                <p className="text-xs text-muted-foreground">
                  {stats.memory.used}MB / {stats.memory.total}MB
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Clock className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Uptime</p>
                <p className="text-lg font-bold">{stats.uptime}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Activity className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Load Average</p>
                <p className="text-lg font-bold">{stats.loadAverage}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Search processes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch}>
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>
        {searchQuery && (
          <Button
            variant="outline"
            onClick={() => {
              setSearchQuery('');
              loadData();
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Process List */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b">
              <tr className="text-left">
                <th className="p-3 font-semibold">PID</th>
                <th className="p-3 font-semibold">User</th>
                <th className="p-3 font-semibold">CPU%</th>
                <th className="p-3 font-semibold">MEM%</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Time</th>
                <th className="p-3 font-semibold flex-1">Command</th>
                <th className="p-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {processes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    {searchQuery ? 'No processes found' : 'No processes running'}
                  </td>
                </tr>
              ) : (
                processes.map((process) => (
                  <tr key={process.pid} className="border-b hover:bg-accent/50">
                    <td className="p-3 font-mono text-sm">{process.pid}</td>
                    <td className="p-3 text-sm">{process.user}</td>
                    <td className="p-3">
                      <span
                        className={`font-semibold ${
                          parseFloat(process.cpu) > 50
                            ? 'text-red-500'
                            : parseFloat(process.cpu) > 25
                            ? 'text-orange-500'
                            : 'text-green-500'
                        }`}
                      >
                        {process.cpu}%
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`font-semibold ${
                          parseFloat(process.mem) > 10
                            ? 'text-red-500'
                            : parseFloat(process.mem) > 5
                            ? 'text-orange-500'
                            : 'text-green-500'
                        }`}
                      >
                        {process.mem}%
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs">{process.stat}</td>
                    <td className="p-3 text-sm">{process.time}</td>
                    <td className="p-3 text-sm font-mono max-w-md truncate" title={process.command}>
                      {process.command}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleKillProcess(process.pid, process.command)}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground mt-4 text-center">
        Showing top 100 processes sorted by CPU usage
        {autoRefresh && ' • Auto-refreshing every 3 seconds'}
      </p>
    </div>
  );
}
