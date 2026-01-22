import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { X, Clock, Info } from 'lucide-react';
import { tasksAPI } from '../services/api';

interface CreateTaskModalProps {
  connectionId: number;
  connectionName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const cronPresets = [
  { label: 'Every minute', value: '* * * * *', description: 'Runs every minute' },
  { label: 'Every 5 minutes', value: '*/5 * * * *', description: 'Runs every 5 minutes' },
  { label: 'Every 15 minutes', value: '*/15 * * * *', description: 'Runs every 15 minutes' },
  { label: 'Every hour', value: '0 * * * *', description: 'Runs at the start of every hour' },
  { label: 'Every day at midnight', value: '0 0 * * *', description: 'Runs daily at 00:00' },
  { label: 'Every day at 3am', value: '0 3 * * *', description: 'Runs daily at 03:00' },
  { label: 'Every Monday at 9am', value: '0 9 * * 1', description: 'Runs every Monday at 09:00' },
  { label: 'Every Sunday at midnight', value: '0 0 * * 0', description: 'Runs every Sunday at 00:00' },
  { label: 'First day of month', value: '0 0 1 * *', description: 'Runs on the 1st of every month' },
];

export default function CreateTaskModal({
  connectionId,
  connectionName,
  onClose,
  onSuccess,
}: CreateTaskModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [schedule, setSchedule] = useState('0 * * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPresets, setShowPresets] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Task name is required');
      return;
    }

    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    if (!schedule.trim()) {
      setError('Schedule is required');
      return;
    }

    setLoading(true);

    try {
      // Validate cron expression first
      const validateResponse = await tasksAPI.validateCron(schedule);
      if (!validateResponse.data.valid) {
        setError('Invalid cron expression');
        setLoading(false);
        return;
      }

      await tasksAPI.create({
        connectionId,
        name,
        description: description || undefined,
        command,
        schedule,
        timezone,
        enabled,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Failed to create task:', error);
      setError(error.response?.data?.error || 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (preset: string) => {
    setSchedule(preset);
    setShowPresets(false);
  };

  return (
    <div className="fixed inset-0 bg-[#141414]/80 flex items-center justify-center z-[100] p-4">
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-[#141414] border-slate-700 shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold">Create Scheduled Task</h2>
              <p className="text-sm text-muted-foreground mt-1">
                For connection: {connectionName}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/50 rounded text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Task Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Daily Database Backup"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this task does"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="command">Command/Script *</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., /home/user/backup.sh or python3 /scripts/cleanup.py"
                className="mt-1.5 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Full path to script or command to execute via SSH
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="schedule">Cron Schedule *</Label>
                <button
                  type="button"
                  onClick={() => setShowPresets(!showPresets)}
                  className="text-xs text-primary hover:underline"
                >
                  {showPresets ? 'Hide presets' : 'Show presets'}
                </button>
              </div>

              {showPresets && (
                <div className="mb-3 p-3 bg-muted rounded-lg space-y-2">
                  <p className="text-xs font-semibold mb-2">Common Schedules:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {cronPresets.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => applyPreset(preset.value)}
                        className="text-left p-2 bg-background hover:bg-accent rounded text-xs border"
                      >
                        <div className="font-medium">{preset.label}</div>
                        <div className="text-muted-foreground">{preset.description}</div>
                        <code className="text-[10px] text-primary">{preset.value}</code>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Input
                id="schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 * * * *"
                className="font-mono"
              />
              <div className="flex items-start gap-2 mt-1.5 text-xs text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>
                  Cron format: minute hour day month weekday
                  <br />
                  Example: <code className="text-primary">0 */6 * * *</code> = Every 6 hours
                </span>
              </div>
            </div>

            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 bg-slate-800 text-foreground border border-input rounded-md"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="enabled" className="cursor-pointer font-normal">
                Enable task immediately after creation
              </Label>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="flex-1">
                {loading ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Task'
                )}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
