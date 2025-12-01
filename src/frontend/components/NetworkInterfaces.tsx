import { Card } from './ui/card';
import { Network } from 'lucide-react';
import { ServerStats } from '../../types';

interface NetworkInterfacesProps {
  stats: ServerStats | null;
}

export function NetworkInterfaces({ stats }: NetworkInterfacesProps) {
  if (!stats) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-border rounded w-40 mb-4"></div>
          <div className="space-y-3">
            {[1, 2].map((i) => (
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
        <Network className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">Network Interfaces</h3>
      </div>
      <div className="space-y-3">
        {stats.network.filter(iface => iface.ip && iface.ip !== '127.0.0.1').map((iface, idx) => (
          <div key={idx} className="border-l-2 border-primary pl-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold">{iface.name}</span>
              <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded">Active</span>
            </div>
            <div className="text-sm text-muted-foreground">
              <div>IP: <span className="text-foreground font-mono">{iface.ip}</span></div>
              {iface.mac && (
                <div>MAC: <span className="text-foreground font-mono text-xs">{iface.mac}</span></div>
              )}
            </div>
          </div>
        ))}
        {stats.network.filter(iface => iface.ip && iface.ip !== '127.0.0.1').length === 0 && (
          <p className="text-sm text-muted-foreground">No active network interfaces</p>
        )}
      </div>
    </Card>
  );
}
