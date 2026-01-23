import { Card } from './ui/card';
import { ServerStats } from '../../types';
import { Activity, XCircle } from 'lucide-react';
import { statsAPI } from '../services/api';
import { useState } from 'react';

interface ProcessListProps {
  stats: ServerStats;
  sessionId?: string;
  onRefresh?: () => void;
}

export function ProcessList({ stats, sessionId, onRefresh }: ProcessListProps) {
  const processes = stats.processes || []; // Show all processes
  const [killingPid, setKillingPid] = useState<string | null>(null);

  const handleKillProcess = async (pid: string, processName: string) => {
    if (!sessionId) return;

    if (!confirm(`Kill process ${pid}?`)) return;

    setKillingPid(pid);
    try {
      await statsAPI.killProcess(sessionId, pid);
      if (onRefresh) onRefresh();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to kill process');
    } finally {
      setKillingPid(null);
    }
  };

  if (processes.length === 0) return null;

  return (
    <Card className="p-3 bg-card/50">
      <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Activity className="h-3 w-3" />
        Top Processes
      </h3>
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
        {processes.map((process, index) => (
          <div
            key={`${process.pid}-${index}`}
            className="flex items-center justify-between text-xs hover:bg-accent/30 rounded px-1.5 py-1 group"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="font-mono text-muted-foreground text-[10px] w-12 flex-shrink-0">
                {process.pid}
              </span>
              <span className="text-muted-foreground w-16 truncate flex-shrink-0">
                {process.user}
              </span>
              <span
                className={`font-semibold w-10 text-right flex-shrink-0 ${
                  parseFloat(process.cpu) > 50
                    ? 'text-red-400'
                    : parseFloat(process.cpu) > 25
                    ? 'text-orange-400'
                    : 'text-green-400'
                }`}
              >
                {process.cpu}%
              </span>
              <span className="text-muted-foreground w-10 text-right flex-shrink-0">
                {process.mem}%
              </span>
              <span className="font-mono text-[10px] truncate flex-1 min-w-0" title={process.command}>
                {process.command}
              </span>
            </div>
            {sessionId && (
              <button
                onClick={() => handleKillProcess(process.pid, process.command)}
                disabled={killingPid === process.pid}
                className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0 hover:text-red-400 disabled:opacity-50"
                title="Kill process"
              >
                <XCircle className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
