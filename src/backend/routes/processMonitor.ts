import express from 'express';
import { getProcesses, getSystemStats, killProcess, searchProcesses } from '../services/processMonitor.js';

const router = express.Router();

// Get processes for a connection
router.get('/:connectionId/processes', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const userId = (req as any).userId;

    const result = await getProcesses(connectionId, userId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to get processes',
      });
    }

    res.json({
      success: true,
      processes: result.processes,
    });
  } catch (error: any) {
    console.error('[ProcessMonitor] Get processes error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Get system stats for a connection
router.get('/:connectionId/stats', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const userId = (req as any).userId;

    const result = await getSystemStats(connectionId, userId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to get system stats',
      });
    }

    res.json({
      success: true,
      stats: result.stats,
    });
  } catch (error: any) {
    console.error('[ProcessMonitor] Get stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Kill a process
router.post('/:connectionId/kill', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const userId = (req as any).userId;
    const { pid, signal } = req.body;

    if (!pid) {
      return res.status(400).json({
        success: false,
        error: 'PID is required',
      });
    }

    const result = await killProcess(connectionId, userId, pid, signal || 'TERM');

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to kill process',
      });
    }

    res.json({
      success: true,
      message: `Process ${pid} terminated`,
    });
  } catch (error: any) {
    console.error('[ProcessMonitor] Kill process error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Search processes
router.get('/:connectionId/search', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const userId = (req as any).userId;
    const query = req.query.q as string;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required',
      });
    }

    const result = await searchProcesses(connectionId, userId, query);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to search processes',
      });
    }

    res.json({
      success: true,
      processes: result.processes,
    });
  } catch (error: any) {
    console.error('[ProcessMonitor] Search processes error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;
