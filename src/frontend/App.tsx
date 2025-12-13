import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import Terminal from './pages/Terminal';
import FileManager from './pages/FileManager';
import Tunnels from './pages/Tunnels';
import ServerDetails from './pages/ServerDetails';
import Workspaces from './pages/Workspaces';
import WorkspaceLauncher from './pages/WorkspaceLauncher';
import DatabaseManager from './pages/DatabaseManager';
import Layout from './components/Layout';
import { Toaster } from 'sonner';

function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <>
      <Toaster position="top-right" richColors />
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />

          {isAuthenticated ? (
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="connections" element={<Connections />} />
              <Route path="workspaces" element={<Workspaces />} />
              <Route path="workspace/:workspaceId" element={<WorkspaceLauncher />} />
              <Route path="terminal/:connectionId" element={<Terminal />} />
              <Route path="database/:connectionId" element={<DatabaseManager />} />
              <Route path="server/:sessionId" element={<ServerDetails />} />
              <Route path="files/:connectionId" element={<FileManager />} />
              <Route path="tunnels/:connectionId" element={<Tunnels />} />
            </Route>
          ) : (
            <Route path="*" element={<Navigate to="/login" replace />} />
          )}
        </Routes>
      </Router>
    </>
  );
}

export default App;
