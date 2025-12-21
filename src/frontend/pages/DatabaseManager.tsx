import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { databaseAPI, connectionsAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { Connection, DatabaseInfo, TableInfo, ColumnInfo, QueryResult } from '../../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  ArrowLeft,
  Database,
  Table,
  Play,
  Save,
  RefreshCw,
  Lock,
  Loader2,
  ChevronRight,
  Search,
  FileText,
  Eye,
  Edit,
  Download,
  FileJson,
  FileSpreadsheet,
  FileCode,
  HardDriveDownload,
} from 'lucide-react';
import { toast } from 'sonner';

type DatabaseManagerProps = {
  connectionIdOverride?: number;
  embedded?: boolean;
  onClose?: () => void;
};

export default function DatabaseManager({ connectionIdOverride, embedded = false, onClose }: DatabaseManagerProps) {
  const { connectionId: routeConnectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const resolvedConnectionId = connectionIdOverride ?? (routeConnectionId ? Number(routeConnectionId) : undefined);
  const { token } = useAuthStore();

  const [connection, setConnection] = useState<Connection | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Password prompt
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Sidebar state
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Main view state
  const [view, setView] = useState<'query' | 'table' | 'structure'>('query');
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [executing, setExecuting] = useState(false);

  // Table data
  const [tableData, setTableData] = useState<QueryResult | null>(null);
  const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([]);
  const [loadingTableData, setLoadingTableData] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string; value: any } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Context menu state for table export
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tableName: string } | null>(null);
  // Context menu state for database export
  const [dbContextMenu, setDbContextMenu] = useState<{ x: number; y: number; dbName: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string>('');

  const primaryKeyColumns = tableColumns.filter((col) => col.key === 'PRI').map((col) => col.name);
  const primaryKeyColumn = primaryKeyColumns[0];

  // Load connection details
  useEffect(() => {
    loadConnection();
  }, [resolvedConnectionId]);

  const loadConnection = async () => {
    try {
      if (!resolvedConnectionId) {
        toast.error('Missing connection');
        return;
      }

      const response = await connectionsAPI.getOne(resolvedConnectionId);
      if (response.data.success) {
        const conn = response.data.data;
        setConnection(conn);

        if (conn.type !== 'database') {
          toast.error('This is not a database connection');
          if (!embedded) {
            navigate('/connections');
          } else if (onClose) {
            onClose();
          }
          return;
        }

        const needsPassword = !conn.password && conn.authType === 'password';
        if (needsPassword) {
          setShowPasswordPrompt(true);
        } else {
          connectToDatabase();
        }
      }
    } catch (error) {
      console.error('Failed to load connection:', error);
      toast.error('Failed to load connection details');
    }
  };

  const connectToDatabase = async (pwd?: string): Promise<string | undefined> => {
    if (!connection && !resolvedConnectionId) return;

    try {
      setConnecting(true);
      const response = await databaseAPI.connect(Number(resolvedConnectionId), pwd);

      if (response.data.success) {
        const newSessionId = response.data.data.sessionId;
        setSessionId(newSessionId);
        setConnected(true);
        setShowPasswordPrompt(false);
        toast.success('Connected to database');

        // Load databases
        await loadDatabases(newSessionId);
        return newSessionId;
      }
    } catch (error: any) {
      console.error('Connection error:', error);
      const errorMsg = error.response?.data?.error || 'Failed to connect to database';
      toast.error(errorMsg);

      if (errorMsg.includes('authentication') || errorMsg.includes('Authentication')) {
        setShowPasswordPrompt(true);
        setPasswordError('Authentication failed. Please check your password.');
      }
    } finally {
      setConnecting(false);
    }

    return sessionId;
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setPasswordError('Password is required');
      return;
    }
    connectToDatabase(password);
  };

  const loadDatabases = async (sid: string) => {
    try {
      const response = await databaseAPI.listDatabases(sid);
      if (response.data.success) {
        setDatabases(response.data.data);

        // Auto-select the first database or the one from connection
        if (connection?.database) {
          setSelectedDatabase(connection.database);
          loadTables(sid, connection.database);
        } else if (response.data.data.length > 0) {
          setSelectedDatabase(response.data.data[0].name);
          loadTables(sid, response.data.data[0].name);
        }
      }
    } catch (error) {
      console.error('Failed to load databases:', error);
      toast.error('Failed to load databases');
    }
  };

  const loadTables = async (sid: string, database: string) => {
    if (!sid) return;
    try {
      const response = await databaseAPI.listTables(sid, database);
      if (response.data.success) {
        setTables(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load tables:', error);
      toast.error('Failed to load tables');
    }
  };

  const handleDatabaseSelect = async (database: string) => {
    const ensuredSession = sessionId || (await connectToDatabase(password || connection?.password));
    if (!ensuredSession) {
      toast.error('Unable to connect to database');
      return;
    }

    setSelectedDatabase(database);
    setSelectedTable('');
    setTableData(null);
    setTableColumns([]);
    loadTables(ensuredSession, database);
  };

  const loadTableStructure = async (table: string, sidOverride?: string) => {
    const sid = sidOverride || sessionId;
    if (!sid) return;

    try {
      const response = await databaseAPI.getTableColumns(sid, table, selectedDatabase);
      if (response.data.success) {
        setTableColumns(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load table structure:', error);
      toast.error('Failed to load table structure');
    }
  };

  const loadTableData = async (table: string, pageIndex = 0, sidOverride?: string) => {
    const sid = sidOverride || sessionId;
    if (!sid) return;

    try {
      setLoadingTableData(true);
      const limit = 100;
      const offset = pageIndex * limit;
      const response = await databaseAPI.getTableData(sid, table, selectedDatabase, limit, offset);
      if (response.data.success) {
        setTableData(response.data.data);
        setHasNextPage((response.data.data.rows || []).length === limit);
        setPage(pageIndex);
      }
    } catch (error) {
      console.error('Failed to load table data:', error);
      toast.error('Failed to load table data');
    } finally {
      setLoadingTableData(false);
    }
  };

  const handleTableSelect = async (table: string) => {
    const ensuredSession = sessionId || (await connectToDatabase(password || connection?.password));
    if (!ensuredSession) {
      toast.error('Unable to connect to database');
      return;
    }

    setSelectedTable(table);
    setView('table');
    await loadTableData(table, 0, ensuredSession);
    await loadTableStructure(table, ensuredSession);
  };

  const executeQuery = async () => {
    if (!query.trim() || !sessionId) return;

    try {
      setExecuting(true);
      const response = await databaseAPI.executeQuery(sessionId, query, selectedDatabase);

      if (response.data.success) {
        setQueryResult(response.data.data);
        if (!response.data.data.error) {
          toast.success('Query executed successfully');
        } else {
          toast.error(response.data.data.error);
        }
      }
    } catch (error: any) {
      console.error('Query execution error:', error);
      toast.error(error.response?.data?.error || 'Failed to execute query');
    } finally {
      setExecuting(false);
    }
  };

  const filteredTables = tables.filter((table) =>
    table.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Format value for display - handles JSON/JSONB objects
  const formatDisplayValue = (value: any): string => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const startEditing = (rowIndex: number, column: string, currentValue: any) => {
    if (savingEdit) return;
    if (primaryKeyColumns.includes(column)) {
      toast.error('Primary key is read-only');
      return;
    }
    setEditingCell({ rowIndex, column, value: currentValue ?? '' });
  };

  const formatValueForSQL = (value: any) => {
    if (value === null || value === undefined || value === '') return 'NULL';
    if (typeof value === 'number') return value.toString();
    // basic escape for single quotes
    const escaped = String(value).replace(/'/g, "''");
    return `'${escaped}'`;
  };

  const saveEdit = async () => {
    if (!editingCell || !tableData || !primaryKeyColumn || !sessionId) return;
    const { rowIndex, column, value } = editingCell;
    const row = tableData.rows[rowIndex];
    if (!row) {
      setEditingCell(null);
      return;
    }
    const pkValue = row[primaryKeyColumn];
    if (pkValue === null || pkValue === undefined) {
      toast.error('Cannot update row without primary key value');
      return;
    }

    const valueSql = formatValueForSQL(value);
    const pkSql = formatValueForSQL(pkValue);
    const updateQuery = `UPDATE "${selectedTable}" SET "${column}" = ${valueSql} WHERE "${primaryKeyColumn}" = ${pkSql};`;

    try {
      setSavingEdit(true);
      const response = await databaseAPI.executeQuery(sessionId, updateQuery, selectedDatabase);
      if (response.data.success && !response.data.data.error) {
        toast.success('Cell updated');
        await loadTableData(selectedTable, page);
      } else {
        toast.error(response.data.data.error || 'Update failed');
      }
    } catch (error: any) {
      console.error('Failed to update cell:', error);
      toast.error(error.response?.data?.error || 'Failed to update cell');
    } finally {
      setSavingEdit(false);
      setEditingCell(null);
    }
  };

  const cancelEdit = () => setEditingCell(null);

  const addRow = async () => {
    if (!sessionId || !selectedTable) return;
    const insertQuery =
      connection?.databaseType === 'mysql' || connection?.databaseType === 'mariadb'
        ? `INSERT INTO \`${selectedTable}\` () VALUES ();`
        : `INSERT INTO "${selectedTable}" DEFAULT VALUES;`;

    try {
      setSavingEdit(true);
      const response = await databaseAPI.executeQuery(sessionId, insertQuery, selectedDatabase);
      if (response.data.success && !response.data.data.error) {
        toast.success('Row added');
        await loadTableData(selectedTable, page);
        await loadTableStructure(selectedTable);
      } else {
        toast.error(response.data.data.error || 'Insert failed');
      }
    } catch (error: any) {
      console.error('Failed to add row:', error);
      toast.error(error.response?.data?.error || 'Failed to add row');
    } finally {
      setSavingEdit(false);
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
      setDbContextMenu(null);
    };
    if (contextMenu || dbContextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu, dbContextMenu]);

  const handleDatabaseContextMenu = (e: React.MouseEvent, dbName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDbContextMenu({ x: e.clientX, y: e.clientY, dbName });
    setContextMenu(null);
  };

  const handleTableContextMenu = (e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tableName });
  };

  const exportTableData = async (tableName: string, format: 'csv' | 'json' | 'sql') => {
    const ensuredSession = sessionId || (await connectToDatabase(password || connection?.password));
    if (!ensuredSession) {
      toast.error('Unable to connect to database');
      return;
    }

    try {
      setExporting(true);
      setContextMenu(null);

      // Fetch all table data for export (no pagination)
      const response = await databaseAPI.getTableData(ensuredSession, tableName, selectedDatabase, 10000, 0);
      if (!response.data.success || response.data.data.error) {
        toast.error(response.data.data?.error || 'Failed to fetch table data');
        return;
      }

      const { columns, rows } = response.data.data;
      let content = '';
      let filename = '';
      let mimeType = '';

      switch (format) {
        case 'csv': {
          // CSV export
          const escapeCSV = (val: any) => {
            if (val === null || val === undefined) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };
          const header = columns.map(escapeCSV).join(',');
          const dataRows = rows.map((row: any) => columns.map((col: string) => escapeCSV(row[col])).join(','));
          content = [header, ...dataRows].join('\n');
          filename = `${tableName}.csv`;
          mimeType = 'text/csv';
          break;
        }
        case 'json': {
          // JSON export
          content = JSON.stringify(rows, null, 2);
          filename = `${tableName}.json`;
          mimeType = 'application/json';
          break;
        }
        case 'sql': {
          // SQL INSERT statements
          const dbType = connection?.databaseType;
          const quote = dbType === 'mysql' || dbType === 'mariadb' ? '`' : '"';
          const formatSQLValue = (val: any) => {
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val.toString();
            if (typeof val === 'boolean') return val ? '1' : '0';
            if (typeof val === 'object') {
              const jsonStr = JSON.stringify(val).replace(/'/g, "''");
              return `'${jsonStr}'`;
            }
            return `'${String(val).replace(/'/g, "''")}'`;
          };
          const insertStatements = rows.map((row: any) => {
            const values = columns.map((col: string) => formatSQLValue(row[col])).join(', ');
            const cols = columns.map((col: string) => `${quote}${col}${quote}`).join(', ');
            return `INSERT INTO ${quote}${tableName}${quote} (${cols}) VALUES (${values});`;
          });
          content = insertStatements.join('\n');
          filename = `${tableName}.sql`;
          mimeType = 'text/plain';
          break;
        }
      }

      // Download file
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${rows.length} rows to ${filename}`);
    } catch (error: any) {
      console.error('Export error:', error);
      toast.error(error.response?.data?.error || 'Failed to export table');
    } finally {
      setExporting(false);
    }
  };

  // Topological sort for table dependencies
  const topologicalSort = (tableList: string[], dependencies: Record<string, string[]>): string[] => {
    const visited = new Set<string>();
    const result: string[] = [];
    
    const visit = (table: string) => {
      if (visited.has(table)) return;
      visited.add(table);
      
      const deps = dependencies[table] || [];
      for (const dep of deps) {
        if (tableList.includes(dep)) {
          visit(dep);
        }
      }
      result.push(table);
    };
    
    for (const table of tableList) {
      visit(table);
    }
    
    return result;
  };

  const exportDatabase = async (dbName: string, options: { includeSchema: boolean; includeData: boolean }) => {
    const ensuredSession = sessionId || (await connectToDatabase(password || connection?.password));
    if (!ensuredSession) {
      toast.error('Unable to connect to database');
      return;
    }

    try {
      setExporting(true);
      setDbContextMenu(null);
      setExportProgress('Loading tables...');

      // For PostgreSQL, we need to ensure we're connected to the right database
      // and then NOT pass the database parameter to avoid reconnection issues
      let currentSession = ensuredSession;
      
      // Switch to the target database if needed
      if (dbName !== selectedDatabase) {
        await handleDatabaseSelect(dbName);
        // After switching, we might need to reconnect for PostgreSQL
        if (connection?.databaseType === 'postgresql') {
          // Reconnect to get a fresh session on the correct database
          const reconnectResponse = await databaseAPI.connect(Number(resolvedConnectionId), password || undefined);
          if (reconnectResponse.data.success) {
            currentSession = reconnectResponse.data.data.sessionId;
            setSessionId(currentSession);
          }
        }
      }

      // Get list of tables - don't pass database for PostgreSQL since we're already connected to it
      const skipDbParam = connection?.databaseType === 'postgresql';
      const tablesResponse = await databaseAPI.listTables(currentSession, skipDbParam ? undefined : dbName);
      if (!tablesResponse.data.success) {
        toast.error('Failed to get tables list');
        return;
      }

      const allTables = tablesResponse.data.data
        .filter((t: TableInfo) => t.type === 'table')
        .map((t: TableInfo) => t.name);

      if (allTables.length === 0) {
        toast.error('No tables found in database');
        return;
      }

      // Try to get migration order first
      setExportProgress('Checking migration order...');
      let tableOrder = [...allTables];
      
      const migrationResponse = await databaseAPI.getMigrationOrder(currentSession, skipDbParam ? undefined : dbName);
      if (migrationResponse.data.success && migrationResponse.data.data) {
        const migrationOrder = migrationResponse.data.data as string[];
        // Reorder tables based on migration order
        const orderedTables: string[] = [];
        for (const migTable of migrationOrder) {
          const match = allTables.find((t: string) => 
            t.toLowerCase() === migTable.toLowerCase() ||
            t.toLowerCase().includes(migTable.toLowerCase())
          );
          if (match && !orderedTables.includes(match)) {
            orderedTables.push(match);
          }
        }
        // Add remaining tables
        for (const table of allTables) {
          if (!orderedTables.includes(table)) {
            orderedTables.push(table);
          }
        }
        tableOrder = orderedTables;
      } else {
        // Fallback to dependency-based ordering
        setExportProgress('Analyzing dependencies...');
        const depsResponse = await databaseAPI.getTableDependencies(currentSession, skipDbParam ? undefined : dbName);
        if (depsResponse.data.success) {
          tableOrder = topologicalSort(allTables, depsResponse.data.data);
        }
      }

      const dbType = connection?.databaseType;
      const quote = dbType === 'mysql' || dbType === 'mariadb' ? '`' : '"';
      const parts: string[] = [];

      // Add header comment
      parts.push(`-- Database Export: ${dbName}`);
      parts.push(`-- Generated: ${new Date().toISOString()}`);
      parts.push(`-- Database Type: ${dbType?.toUpperCase()}`);
      parts.push(`-- Tables: ${tableOrder.length}`);
      parts.push('');

      if (options.includeSchema) {
        // Disable foreign key checks at the start
        if (dbType === 'mysql' || dbType === 'mariadb') {
          parts.push('SET FOREIGN_KEY_CHECKS = 0;');
          parts.push('');
        } else if (dbType === 'postgresql') {
          parts.push('SET session_replication_role = replica;');
          parts.push('');
        }

        parts.push('-- =====================');
        parts.push('-- TABLE SCHEMAS');
        parts.push('-- =====================');
        parts.push('');

        // Export schemas in order
        for (let i = 0; i < tableOrder.length; i++) {
          const table = tableOrder[i];
          setExportProgress(`Exporting schema: ${table} (${i + 1}/${tableOrder.length})`);
          
          try {
            const schemaResponse = await databaseAPI.getTableSchema(currentSession, table, skipDbParam ? undefined : dbName);
            if (schemaResponse.data.success && schemaResponse.data.data) {
              // Add DROP TABLE IF EXISTS
              parts.push(`-- Table: ${table}`);
              parts.push(`DROP TABLE IF EXISTS ${quote}${table}${quote} CASCADE;`);
              parts.push(schemaResponse.data.data);
              parts.push('');
            }
          } catch (err: any) {
            console.error(`Failed to get schema for ${table}:`, err);
            parts.push(`-- Failed to export schema for ${table}: ${err.message || 'Unknown error'}`);
            parts.push('');
          }
        }
      }

      if (options.includeData) {
        parts.push('-- =====================');
        parts.push('-- TABLE DATA');
        parts.push('-- =====================');
        parts.push('');

        const formatSQLValue = (val: any) => {
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val.toString();
          if (typeof val === 'boolean') return val ? '1' : '0';
          if (typeof val === 'object') {
            const jsonStr = JSON.stringify(val).replace(/'/g, "''");
            return `'${jsonStr}'`;
          }
          return `'${String(val).replace(/'/g, "''")}'`;
        };

        // Export data in order
        for (let i = 0; i < tableOrder.length; i++) {
          const table = tableOrder[i];
          setExportProgress(`Exporting data: ${table} (${i + 1}/${tableOrder.length})`);
          
          try {
            // Fetch all data (up to 100k rows per table)
            const dataResponse = await databaseAPI.getTableData(currentSession, table, skipDbParam ? undefined : dbName, 100000, 0);
            if (dataResponse.data.success && !dataResponse.data.data.error) {
              const { columns, rows } = dataResponse.data.data;
              
              if (rows.length > 0) {
                parts.push(`-- Data for table: ${table} (${rows.length} rows)`);
                
                const insertStatements = rows.map((row: any) => {
                  const values = columns.map((col: string) => formatSQLValue(row[col])).join(', ');
                  const cols = columns.map((col: string) => `${quote}${col}${quote}`).join(', ');
                  return `INSERT INTO ${quote}${table}${quote} (${cols}) VALUES (${values});`;
                });
                
                parts.push(insertStatements.join('\n'));
                parts.push('');
              } else {
                parts.push(`-- Table ${table} is empty`);
                parts.push('');
              }
            } else if (dataResponse.data.data?.error) {
              parts.push(`-- Failed to export data for ${table}: ${dataResponse.data.data.error}`);
              parts.push('');
            }
          } catch (err: any) {
            console.error(`Failed to get data for ${table}:`, err);
            parts.push(`-- Failed to export data for ${table}: ${err.message || 'Unknown error'}`);
            parts.push('');
          }
        }
      }

      if (options.includeSchema) {
        // Re-enable foreign key checks at the end
        if (dbType === 'mysql' || dbType === 'mariadb') {
          parts.push('SET FOREIGN_KEY_CHECKS = 1;');
        } else if (dbType === 'postgresql') {
          parts.push('SET session_replication_role = DEFAULT;');
        }
      }

      const content = parts.join('\n');
      const filename = `${dbName}_${options.includeSchema && options.includeData ? 'full' : options.includeSchema ? 'schema' : 'data'}_export.sql`;

      // Download file
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${tableOrder.length} tables to ${filename}`);
    } catch (error: any) {
      console.error('Database export error:', error);
      toast.error(error.response?.data?.error || 'Failed to export database');
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  };

  if (!connection && !connecting) {
    return (
      <div className={`flex items-center justify-center ${embedded ? 'h-full' : 'h-screen'}`}>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className={`${embedded ? 'h-full' : 'h-screen'} min-h-0 flex flex-col overflow-hidden bg-dark text-gray-100`}
    >
      {/* Password Prompt Modal */}
      {showPasswordPrompt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="rounded-full bg-primary/20 p-3">
                <Lock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Authentication Required</h2>
                <p className="text-sm text-muted-foreground">
                  Enter password for {connection?.username}@{connection?.host}
                </p>
              </div>
            </div>

            {passwordError && (
              <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
                {passwordError}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password..."
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={connecting}>
                  {connecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (embedded && onClose) onClose();
                    else navigate('/connections');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Header - Only show in non-embedded mode or show minimal in embedded */}
      {!embedded ? (
        <div className="flex items-center justify-between bg-dark-lighter border-b border-dark-border flex-shrink-0 px-6 py-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/connections')}
              className="text-slate-500 hover:text-slate-300 h-7 w-7 flex-shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="font-semibold text-white flex items-center gap-1.5 truncate text-base">
                <Database className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{connection?.name || 'Database'}</span>
              </h1>
              {connection && (
                <p className="text-xs text-slate-500 truncate">
                  {connection.databaseType?.toUpperCase()} - {connection.username}@{connection.host}:{connection.port}
                </p>
              )}
            </div>
          </div>
          {connected && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span>Connected</span>
            </div>
          )}
        </div>
      ) : connected && (
        <div className="flex items-center justify-between bg-dark-lighter/50 border-b border-dark-border flex-shrink-0 px-2 py-1">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Database className="h-3 w-3" />
            <span className="truncate">{selectedDatabase || connection?.database || 'Select DB'}</span>
          </div>
          {connected && (
            <div className="flex items-center gap-1 text-[9px] text-green-400">
              <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
              <span>Live</span>
            </div>
          )}
        </div>
      )}

      {connected && (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Sidebar - Databases and Tables */}
          <div className={`border-r border-dark-border bg-dark-lighter flex flex-col min-h-0 overflow-hidden flex-shrink-0 ${embedded ? 'w-36' : 'w-56'}`}>
            <div className="p-1.5 border-b border-dark-border flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-500" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className={`pl-6 ${embedded ? 'h-6 text-[10px]' : 'h-7 text-[11px]'}`}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {/* Databases */}
              <div className="p-1">
                {databases.map((db) => (
                  <div key={db.name} className="mb-0.5">
                    <button
                      onClick={() => handleDatabaseSelect(db.name)}
                      onContextMenu={(e) => handleDatabaseContextMenu(e, db.name)}
                      className={`w-full flex items-center gap-1 px-1.5 py-1 rounded transition-colors truncate ${embedded ? 'text-[10px]' : 'text-[11px]'} ${
                        selectedDatabase === db.name
                          ? 'bg-slate-800 text-blue-400 font-medium'
                          : 'hover:bg-slate-800 text-slate-300'
                      }`}
                      title={`${db.name} (right-click to export)`}
                    >
                      <Database className={`flex-shrink-0 ${embedded ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} />
                      <span className="truncate">{db.name}</span>
                    </button>

                    {/* Tables under selected database */}
                    {selectedDatabase === db.name && filteredTables.length > 0 && (
                      <div className="ml-1.5 mt-0.5 space-y-0.5 border-l border-dark-border pl-1.5">
                        {filteredTables.map((table) => (
                          <button
                            key={table.name}
                            onClick={() => handleTableSelect(table.name)}
                            onContextMenu={(e) => handleTableContextMenu(e, table.name)}
                            className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors truncate ${embedded ? 'text-[9px]' : 'text-[10px]'} ${
                              selectedTable === table.name
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'hover:bg-slate-800/50 text-muted-foreground'
                            }`}
                            title={`${table.name} (right-click to export)`}
                          >
                            <Table className={`flex-shrink-0 ${embedded ? 'h-2 w-2' : 'h-2.5 w-2.5'}`} />
                            <span className="truncate">{table.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0 bg-dark">
            {/* View Tabs */}
            <div className={`flex items-center gap-0.5 bg-slate-900/30 border-b border-slate-800 flex-shrink-0 ${embedded ? 'px-1 py-1' : 'px-2 py-1.5'}`}>
              <Button
                onClick={() => setView('query')}
                variant={view === 'query' ? 'default' : 'ghost'}
                size="sm"
                className={`gap-1 ${embedded ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]'}`}
              >
                <FileText className="h-3 w-3" />
                Query
              </Button>
              {selectedTable && (
                <>
                  <Button
                    onClick={() => setView('table')}
                    variant={view === 'table' ? 'default' : 'ghost'}
                    size="sm"
                    className={`gap-1 ${embedded ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]'}`}
                  >
                    <Eye className={embedded ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
                    Data
                  </Button>
                  <Button
                    onClick={() => setView('structure')}
                    variant={view === 'structure' ? 'default' : 'ghost'}
                    size="sm"
                    className={`gap-1 ${embedded ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]'}`}
                  >
                    <Table className={embedded ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
                    Structure
                  </Button>
                </>
              )}
            </div>

            {/* Query Editor */}
            {view === 'query' && (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${embedded ? 'p-1.5' : 'p-2'}`}>
                  <div className="flex items-center justify-between mb-1 flex-shrink-0">
                    <Label className={`font-medium text-slate-400 ${embedded ? 'text-[10px]' : 'text-[11px]'}`}>SQL</Label>
                    <Button
                      onClick={executeQuery}
                      disabled={executing || !query.trim()}
                      size="sm"
                      className={`gap-1 ${embedded ? 'h-5 px-1.5 text-[9px]' : 'h-6 px-2 text-[11px]'}`}
                    >
                      {executing ? (
                        <>
                          <Loader2 className={embedded ? 'h-2.5 w-2.5 animate-spin' : 'h-3 w-3 animate-spin'} />
                          {!embedded && 'Running...'}
                        </>
                      ) : (
                        <>
                          <Play className={embedded ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
                          {embedded ? 'Run' : 'Execute'}
                        </>
                      )}
                    </Button>
                  </div>

                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="SELECT * FROM users;"
                    className={`flex-1 bg-slate-950 border border-slate-800 rounded font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-slate-500 ${embedded ? 'min-h-[40px] p-1.5 text-[10px]' : 'min-h-[60px] p-2 text-[11px]'}`}
                    spellCheck={false}
                  />
                </div>

                {/* Query Results */}
                {queryResult && (
                  <div className="border-t border-slate-800 flex-1 flex flex-col overflow-hidden min-h-0">
                    <div className={`bg-slate-900/30 border-b border-slate-800 flex-shrink-0 ${embedded ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}>
                      <div className={`flex items-center justify-between ${embedded ? 'text-[9px]' : 'text-[10px]'}`}>
                        <span className="text-slate-400">
                          {queryResult.error ? (
                            <span className="text-red-300">{queryResult.error}</span>
                          ) : queryResult.affectedRows !== undefined ? (
                            `${queryResult.affectedRows} rows affected`
                          ) : (
                            `${queryResult.rowCount} rows`
                          )}
                        </span>
                        {queryResult.executionTime && (
                          <span className="text-slate-500">{queryResult.executionTime}ms</span>
                        )}
                      </div>
                    </div>

                    {!queryResult.error && queryResult.rows.length > 0 && (
                      <div className="flex-1 min-h-0 overflow-auto">
                        <div className="p-2 min-w-max">
                          <table className="w-full text-[10px] text-white border-collapse">
                            <thead className="bg-slate-900 sticky top-0 z-10">
                              <tr>
                                {queryResult.columns.map((col) => (
                                  <th
                                    key={col}
                                    className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap"
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {queryResult.rows.map((row, i) => (
                                <tr key={i} className="odd:bg-slate-950 even:bg-slate-900/40 hover:bg-slate-800">
                                  {queryResult.columns.map((col) => (
                                    <td key={col} className="px-2 py-1 text-slate-300 border-b border-slate-800/50 whitespace-nowrap max-w-[200px] truncate" title={formatDisplayValue(row[col])}>
                                      {row[col] === null ? (
                                        <span className="italic text-slate-500">NULL</span>
                                      ) : typeof row[col] === 'object' ? (
                                        <span className="text-amber-300/80 font-mono">{formatDisplayValue(row[col])}</span>
                                      ) : (
                                        formatDisplayValue(row[col])
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Table Data View */}
            {view === 'table' && selectedTable && (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="px-2 py-1.5 bg-dark-lighter border-b border-dark-border flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h3 className="text-[11px] font-semibold text-slate-100 truncate">
                      {selectedTable}
                    </h3>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-dark text-gray-300 border border-dark-border flex-shrink-0">P{page + 1}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button onClick={() => loadTableData(selectedTable, page)} size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-gray-300 hover:bg-dark">
                      <RefreshCw className="h-2.5 w-2.5" />
                    </Button>
                    <Button
                      onClick={() => setIsCollapsed((v) => !v)}
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-gray-300 hover:bg-dark"
                    >
                      <ChevronRight className={`h-2.5 w-2.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                    </Button>
                  </div>
                </div>

                {loadingTableData ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : tableData ? (
                  <div className="flex-1 min-h-0 flex flex-col bg-dark overflow-hidden">
                    {!isCollapsed && (
                      <div className="flex-1 min-h-0 overflow-auto">
                        <div className="p-1.5 min-w-max">
                          <table className="w-full text-[10px] text-gray-200 border-collapse">
                            <thead className="bg-dark-lighter sticky top-0 z-10">
                              <tr>
                                {tableData.columns.map((col) => (
                                  <th
                                    key={col}
                                    className="px-2 py-1.5 text-left font-medium text-gray-100 border-b border-dark-border whitespace-nowrap"
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {tableData.rows.map((row, i) => (
                                <tr key={i} className="odd:bg-dark even:bg-dark-lighter/40 hover:bg-dark-lighter">
                                  {tableData.columns.map((col) => {
                                    const isEditing = editingCell && editingCell.rowIndex === i && editingCell.column === col;
                                    const displayValue = row[col];
                                    const isPrimary = primaryKeyColumns.includes(col);
                                    return (
                                      <td key={col} className="px-2 py-1 text-gray-100 align-middle border-b border-dark-border/50 whitespace-nowrap max-w-[150px]">
                                        {isEditing ? (
                                          <input
                                            autoFocus
                                            className="w-full bg-dark-lighter border border-primary rounded px-1.5 py-0.5 text-gray-100 text-[10px]"
                                            value={editingCell.value ?? ''}
                                            onChange={(e) => setEditingCell({ rowIndex: i, column: col, value: e.target.value })}
                                            onBlur={saveEdit}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') saveEdit();
                                              if (e.key === 'Escape') cancelEdit();
                                            }}
                                            disabled={savingEdit}
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            className={`w-full text-left truncate block ${isPrimary ? 'text-gray-500 cursor-not-allowed' : 'cursor-text hover:text-white'}`}
                                            onDoubleClick={() => startEditing(i, col, typeof displayValue === 'object' ? JSON.stringify(displayValue) : displayValue)}
                                            disabled={savingEdit || isPrimary}
                                            title={formatDisplayValue(displayValue)}
                                          >
                                            {displayValue === null ? (
                                              <span className="italic text-gray-500">NULL</span>
                                            ) : typeof displayValue === 'object' ? (
                                              <span className="text-amber-300/80 font-mono">{formatDisplayValue(displayValue)}</span>
                                            ) : (
                                              formatDisplayValue(displayValue)
                                            )}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="border-t border-dark-border bg-dark-lighter px-2 py-1.5 flex items-center gap-1 justify-between flex-shrink-0">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] bg-dark text-gray-100 hover:bg-dark-lighter border border-dark-border"
                          onClick={saveEdit}
                          disabled={!editingCell || savingEdit}
                        >
                          Apply
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] bg-dark text-gray-100 hover:bg-dark-lighter border border-dark-border"
                          onClick={addRow}
                          disabled={savingEdit}
                        >
                          +Row
                        </Button>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 bg-dark text-gray-200 hover:bg-dark-lighter border border-dark-border"
                          onClick={() => {
                            const nextPage = Math.max(0, page - 1);
                            loadTableData(selectedTable, nextPage);
                          }}
                          disabled={page === 0 || savingEdit}
                        >
                          ‹
                        </Button>
                        <span className="text-gray-300 text-[10px] px-1.5 py-0.5 rounded bg-dark border border-dark-border">
                          {page + 1}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 bg-dark text-gray-200 hover:bg-dark-lighter border border-dark-border"
                          onClick={() => loadTableData(selectedTable, page + 1)}
                          disabled={!hasNextPage || savingEdit}
                        >
                          ›
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-slate-400">
                    No data to display
                  </div>
                )}
              </div>
            )}

            {/* Table Structure View */}
            {view === 'structure' && selectedTable && (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="px-2 py-1.5 bg-slate-900/30 border-b border-slate-800 flex-shrink-0">
                  <h3 className="text-[11px] font-semibold text-white truncate">
                    {selectedTable} - Structure
                  </h3>
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                  <div className="p-1.5 min-w-max">
                    <table className="w-full text-[10px] text-white border-collapse">
                      <thead className="bg-slate-900 sticky top-0 z-10">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap">Column</th>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap">Type</th>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap">Null</th>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap">Key</th>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap">Default</th>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-300 border-b border-slate-800 whitespace-nowrap">Extra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableColumns.map((col) => (
                          <tr key={col.name} className="odd:bg-slate-950 even:bg-slate-900/40 hover:bg-slate-800">
                            <td className="px-2 py-1 font-medium text-slate-300 border-b border-slate-800/50 whitespace-nowrap">{col.name}</td>
                            <td className="px-2 py-1 text-slate-400 border-b border-slate-800/50 whitespace-nowrap">{col.type}</td>
                            <td className="px-2 py-1 text-slate-400 border-b border-slate-800/50">
                              {col.nullable ? '✓' : '✗'}
                            </td>
                            <td className="px-2 py-1 border-b border-slate-800/50">
                              {col.key && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                                  col.key === 'PRI' ? 'bg-primary/10 text-primary' :
                                  col.key === 'UNI' ? 'bg-blue-500/10 text-blue-500' :
                                  'bg-slate-800 text-slate-400'
                                }`}>
                                  {col.key}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-slate-400 border-b border-slate-800/50 whitespace-nowrap max-w-[100px] truncate" title={col.default === null ? 'NULL' : col.default || '-'}>
                              {col.default === null ? (
                                <span className="italic text-slate-500">NULL</span>
                              ) : (
                                col.default || '-'
                              )}
                            </td>
                            <td className="px-2 py-1 text-slate-400 border-b border-slate-800/50 whitespace-nowrap">
                              {col.extra || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Menu for Table Export */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-dark-lighter border border-dark-border rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] text-slate-500 border-b border-dark-border mb-1">
            Export "{contextMenu.tableName}"
          </div>
          <button
            onClick={() => exportTableData(contextMenu.tableName, 'csv')}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-green-400" />
            Export as CSV
          </button>
          <button
            onClick={() => exportTableData(contextMenu.tableName, 'json')}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          >
            <FileJson className="h-3.5 w-3.5 text-amber-400" />
            Export as JSON
          </button>
          <button
            onClick={() => exportTableData(contextMenu.tableName, 'sql')}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          >
            <FileCode className="h-3.5 w-3.5 text-blue-400" />
            Export as SQL
          </button>
        </div>
      )}

      {/* Context Menu for Database Export */}
      {dbContextMenu && (
        <div
          className="fixed z-50 bg-dark-lighter border border-dark-border rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ left: dbContextMenu.x, top: dbContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] text-slate-500 border-b border-dark-border mb-1">
            Export Database "{dbContextMenu.dbName}"
          </div>
          <button
            onClick={() => exportDatabase(dbContextMenu.dbName, { includeSchema: true, includeData: true })}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          >
            <HardDriveDownload className="h-3.5 w-3.5 text-purple-400" />
            Full Export (Schema + Data)
          </button>
          <button
            onClick={() => exportDatabase(dbContextMenu.dbName, { includeSchema: true, includeData: false })}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          >
            <FileCode className="h-3.5 w-3.5 text-blue-400" />
            Schema Only
          </button>
          <button
            onClick={() => exportDatabase(dbContextMenu.dbName, { includeSchema: false, includeData: true })}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          >
            <Table className="h-3.5 w-3.5 text-green-400" />
            Data Only
          </button>
          {exporting && exportProgress && (
            <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-dark-border mt-1 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate">{exportProgress}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
