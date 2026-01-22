import { useState, useEffect } from 'react';
import { tasksAPI, connectionsAPI } from '../services/api';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Plus, Play, Trash2, Edit, Clock, Check, X, AlertCircle, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import CreateTaskModal from '../components/CreateTaskModal';

interface ScheduledTask {
  id: number;
  connection_id: number;
  connection_name: string;
  host: string;
  name: string;
  description?: string;
  command: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  last_run?: string;
  last_status?: string;
  last_output?: string;
  last_error?: string;
  run_count: number;
  created_at: string;
}

export default function ScheduledTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<any>(null);

  useEffect(() => {
    loadTasks();
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const response = await connectionsAPI.getAll();
      if (response.data.success) {
        // Filter only SSH connections
        const sshConnections = response.data.data.filter((conn: any) => conn.type === 'ssh');
        setConnections(sshConnections);
      }
    } catch (error: any) {
      console.error('Failed to load connections:', error);
    }
  };

  const loadTasks = async () => {
    try {
      setLoading(true);
      const response = await tasksAPI.getAll();
      if (response.data.success) {
        setTasks(response.data.data);
      }
    } catch (error: any) {
      console.error('Failed to load tasks:', error);
      setError(error.response?.data?.error || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      await tasksAPI.delete(taskId);
      await loadTasks();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to delete task');
    }
  };

  const handleExecute = async (taskId: number) => {
    try {
      const response = await tasksAPI.execute(taskId);
      if (response.data.success) {
        alert('Task executed successfully');
        await loadTasks();
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to execute task');
    }
  };

  const handleToggleEnabled = async (task: ScheduledTask) => {
    try {
      await tasksAPI.update(task.id, { enabled: !task.enabled });
      await loadTasks();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to update task');
    }
  };

  const viewLogs = async (task: ScheduledTask) => {
    try {
      const response = await tasksAPI.getLogs(task.id, 50);
      if (response.data.success) {
        setLogs(response.data.data);
        setSelectedTask(task);
        setShowLogs(true);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to load logs');
    }
  };

  const getStatusColor = (status?: string) => {
    if (!status) return 'text-muted-foreground';
    switch (status) {
      case 'success':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'running':
        return 'text-blue-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusIcon = (status?: string) => {
    if (!status) return <Clock className="h-4 w-4" />;
    switch (status) {
      case 'success':
        return <Check className="h-4 w-4" />;
      case 'error':
        return <X className="h-4 w-4" />;
      case 'running':
        return <Clock className="h-4 w-4 animate-spin" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading tasks...</p>
        </div>
      </div>
    );
  }

  if (showLogs && selectedTask) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="mb-6">
          <Button variant="outline" onClick={() => setShowLogs(false)} className="mb-4">
            ← Back to Tasks
          </Button>
          <h1 className="text-3xl font-bold mb-2">Execution Logs</h1>
          <p className="text-muted-foreground">
            {selectedTask.name} - {selectedTask.connection_name}
          </p>
        </div>

        <div className="space-y-4">
          {logs.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              No execution logs found
            </Card>
          ) : (
            logs.map((log) => (
              <Card key={log.id} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={getStatusColor(log.status)}>
                      {getStatusIcon(log.status)}
                    </span>
                    <span className="font-semibold capitalize">{log.status}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(log.started_at), 'MMM dd, yyyy HH:mm:ss')}
                    {log.duration_ms && ` (${log.duration_ms}ms)`}
                  </div>
                </div>

                {log.output && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold mb-1">Output:</p>
                    <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
                      {log.output}
                    </pre>
                  </div>
                )}

                {log.error && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold mb-1 text-destructive">Error:</p>
                    <pre className="bg-destructive/10 p-3 rounded text-sm overflow-x-auto text-destructive">
                      {log.error}
                    </pre>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Scheduled Tasks</h1>
          <p className="text-muted-foreground">
            Manage cron jobs and scheduled scripts
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      {error && (
        <Card className="p-4 mb-6 border-destructive">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {tasks.length === 0 ? (
        <Card className="p-12 text-center">
          <Calendar className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-semibold mb-2">No scheduled tasks yet</h3>
          <p className="text-muted-foreground mb-6">
            Create your first scheduled task to automate commands on your servers
          </p>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Task
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {tasks.map((task) => (
            <Card key={task.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-semibold">{task.name}</h3>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        task.enabled
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {task.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {task.last_status && (
                      <span
                        className={`flex items-center gap-1 text-sm ${getStatusColor(
                          task.last_status
                        )}`}
                      >
                        {getStatusIcon(task.last_status)}
                        {task.last_status}
                      </span>
                    )}
                  </div>

                  {task.description && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {task.description}
                    </p>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Server:</span>
                      <span className="text-muted-foreground">
                        {task.connection_name} ({task.host})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Schedule:</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {task.schedule}
                      </code>
                      <span className="text-muted-foreground">({task.timezone})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Command:</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {task.command}
                      </code>
                    </div>
                    {task.last_run && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Last run:</span>
                        <span className="text-muted-foreground">
                          {format(new Date(task.last_run), 'MMM dd, yyyy HH:mm:ss')}
                        </span>
                        <span className="text-muted-foreground">
                          ({task.run_count} times)
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 ml-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewLogs(task)}
                    title="View logs"
                  >
                    <Calendar className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExecute(task.id)}
                    title="Run now"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleEnabled(task)}
                    title={task.enabled ? 'Disable' : 'Enable'}
                  >
                    {task.enabled ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => alert('Edit modal coming soon')}
                    title="Edit"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(task.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Connection Selector Modal */}
      {showCreateModal && !selectedConnection && (
        <div className="fixed inset-0 bg-[#141414]/80 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full bg-[#141414] border-slate-700">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Select SSH Connection</h2>
                <Button variant="ghost" size="icon" onClick={() => setShowCreateModal(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Choose which SSH server to run the scheduled task on
              </p>

              {connections.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No SSH connections found</p>
                  <Button onClick={() => window.location.href = '/connections'}>
                    Create SSH Connection
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => setSelectedConnection(conn)}
                      className="w-full p-3 text-left border rounded-lg hover:bg-accent transition-colors"
                    >
                      <div className="font-medium">{conn.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {conn.username}@{conn.host}:{conn.port}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && selectedConnection && (
        <CreateTaskModal
          connectionId={selectedConnection.id}
          connectionName={selectedConnection.name}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedConnection(null);
          }}
          onSuccess={() => {
            loadTasks();
          }}
        />
      )}
    </div>
  );
}
