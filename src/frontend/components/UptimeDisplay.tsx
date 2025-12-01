import { Card } from './ui/card';
import { Clock } from 'lucide-react';
import { ServerStats } from '../../types';

interface UptimeDisplayProps {
  stats: ServerStats | null;
}

export function UptimeDisplay({ stats }: UptimeDisplayProps) {
  if (!stats) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-border rounded w-24 mb-4"></div>
          <div className="h-8 bg-border rounded w-32"></div>
        </div>
      </Card>
    );
  }

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-success" />
        <h3 className="font-semibold text-lg">Uptime</h3>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-3xl font-bold text-success">
          {formatUptime(stats.uptime)}
        </div>
        <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
      </div>
      <p className="text-sm text-muted-foreground mt-2">
        Server has been running for {formatUptime(stats.uptime)}
      </p>
    </Card>
  );
}
