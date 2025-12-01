import { Card } from './ui/card';
import { Server, Monitor } from 'lucide-react';
import { ServerStats } from '../../types';

interface SystemInfoProps {
  stats: ServerStats | null;
}

export function SystemInfo({ stats }: SystemInfoProps) {
  if (!stats) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-border rounded w-32 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 bg-border rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Server className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">System Information</h3>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
          <span className="text-sm text-muted-foreground">Hostname:</span>
          <span className="text-sm font-medium">{stats.system.hostname}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success"></div>
          <span className="text-sm text-muted-foreground">Operating System:</span>
          <span className="text-sm font-medium">{stats.system.os}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success"></div>
          <span className="text-sm text-muted-foreground">Kernel:</span>
          <span className="text-sm font-medium">{stats.system.kernel}</span>
        </div>
      </div>
    </Card>
  );
}
