import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const authData = localStorage.getItem('auth-storage');
    if (authData) {
      const { state } = JSON.parse(authData);
      if (state.token) {
        config.headers.Authorization = `Bearer ${state.token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// Auth API
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  register: (username: string, password: string) =>
    api.post('/auth/register', { username, password }),
  verify: () => api.get('/auth/verify'),
};

// Connections API
export const connectionsAPI = {
  getAll: () => api.get('/connections'),
  getOne: (id: number) => api.get(`/connections/${id}`),
  create: (data: any) => api.post('/connections', data),
  update: (id: number, data: any) => api.put(`/connections/${id}`, data),
  delete: (id: number) => api.delete(`/connections/${id}`),
};

// Files API
export const filesAPI = {
  connect: (connectionId: number, password?: string) => 
    api.post('/files/connect', { connectionId, ...(password && { password }) }),
  disconnect: (sessionId: string, type: string) =>
    api.post('/files/disconnect', { sessionId, type }),
  list: (sessionId: string, path: string, type: string) =>
    api.get('/files/list', { params: { sessionId, path, type } }),
  read: (sessionId: string, path: string, type: string) =>
    api.get('/files/read', { params: { sessionId, path, type } }),
  write: (sessionId: string, path: string, content: string, type: string) =>
    api.post('/files/write', { sessionId, path, content, type }),
  delete: (sessionId: string, path: string, isDirectory: boolean, type: string) =>
    api.delete('/files/delete', { data: { sessionId, path, isDirectory, type } }),
  rename: (sessionId: string, oldPath: string, newPath: string, type: string) =>
    api.post('/files/rename', { sessionId, oldPath, newPath, type }),
  mkdir: (sessionId: string, path: string, type: string) =>
    api.post('/files/mkdir', { sessionId, path, type }),
  status: (sessionId: string, type: string) =>
    api.get('/files/status', { params: { sessionId, type } }),
};

// Tunnels API
export const tunnelsAPI = {
  getAll: (connectionId: number) => api.get(`/tunnels/${connectionId}`),
  create: (data: any) => api.post('/tunnels', data),
  start: (tunnelId: number, sessionId: string) =>
    api.post(`/tunnels/${tunnelId}/start`, { sessionId }),
  stop: (tunnelId: number) => api.post(`/tunnels/${tunnelId}/stop`),
  delete: (tunnelId: number) => api.delete(`/tunnels/${tunnelId}`),
};

// Stats API
export const statsAPI = {
  getStats: (sessionId: string) => api.get(`/stats/${sessionId}`),
  getLatestStats: (connectionId: number) => api.get(`/stats/connection/${connectionId}/latest`),
  fetchFreshStats: (connectionId: number, password?: string) =>
    api.post(`/stats/connection/${connectionId}/fetch`, { password }),
};

// Workspaces API
export const workspacesAPI = {
  getAll: () => api.get('/workspaces'),
  getOne: (id: number) => api.get(`/workspaces/${id}`),
  create: (data: any) => api.post('/workspaces', data),
  update: (id: number, data: any) => api.put(`/workspaces/${id}`, data),
  delete: (id: number) => api.delete(`/workspaces/${id}`),
};

// Database API
export const databaseAPI = {
  connect: (connectionId: number, password?: string) =>
    api.post('/database/connect', { connectionId, password }),
  disconnect: (sessionId: string) =>
    api.post(`/database/disconnect/${sessionId}`),
  listDatabases: (sessionId: string) =>
    api.get(`/database/databases/${sessionId}`),
  listTables: (sessionId: string, database?: string) =>
    api.get(`/database/tables/${sessionId}`, { params: { database } }),
  getTableColumns: (sessionId: string, tableName: string, database?: string) =>
    api.get(`/database/columns/${sessionId}/${tableName}`, { params: { database } }),
  executeQuery: (sessionId: string, query: string, database?: string) =>
    api.post(`/database/query/${sessionId}`, { query, database }),
  getTableData: (sessionId: string, tableName: string, database?: string, limit = 100, offset = 0) =>
    api.get(`/database/table-data/${sessionId}/${tableName}`, {
      params: { database, limit, offset },
    }),
  getTableSchema: (sessionId: string, tableName: string, database?: string) =>
    api.get(`/database/schema/${sessionId}/${tableName}`, { params: { database } }),
  getMigrationOrder: (sessionId: string, database?: string) =>
    api.get(`/database/migrations/${sessionId}`, { params: { database } }),
  getTableDependencies: (sessionId: string, database?: string) =>
    api.get(`/database/dependencies/${sessionId}`, { params: { database } }),
};
