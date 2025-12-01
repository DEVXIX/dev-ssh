import { Card } from './ui/card';
import { Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { ServerStats } from '../../types';

interface ServerMetricsProps {
  stats: ServerStats | null;
}

export function ServerMetrics({ stats }: ServerMetricsProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-6">
            <div className="animate-pulse">
              <div className="h-4 bg-border rounded w-20 mb-4"></div>
              <div className="h-8 bg-border rounded w-16 mb-2"></div>
              <div className="h-2 bg-border rounded w-full"></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* CPU Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">CPU</h3>
          </div>
          <span className="text-2xl font-bold">{stats.cpu.usage.toFixed(1)}%</span>
        </div>
        <div className="space-y-2">
          <div className="w-full bg-border rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(stats.cpu.usage, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{stats.cpu.cores} cores</span>
            <span>Load: {stats.cpu.loadAvg[0]?.toFixed(2)}</span>
          </div>
        </div>
      </Card>

      {/* Memory Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MemoryStick className="w-5 h-5 text-success" />
            <h3 className="font-semibold">Memory</h3>
          </div>
          <span className="text-2xl font-bold">{stats.memory.usagePercent.toFixed(1)}%</span>
        </div>
        <div className="space-y-2">
          <div className="w-full bg-border rounded-full h-2">
            <div
              className="bg-success h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(stats.memory.usagePercent, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{formatBytes(stats.memory.used)} used</span>
            <span>{formatBytes(stats.memory.total)} total</span>
          </div>
        </div>
      </Card>

      {/* Disk Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-warning" />
            <h3 className="font-semibold">Disk</h3>
          </div>
          <span className="text-2xl font-bold">{stats.disk.usagePercent.toFixed(1)}%</span>
        </div>
        <div className="space-y-2">
          <div className="w-full bg-border rounded-full h-2">
            <div
              className="bg-warning h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(stats.disk.usagePercent, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{formatBytes(stats.disk.used)} used</span>
            <span>{formatBytes(stats.disk.total)} total</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
