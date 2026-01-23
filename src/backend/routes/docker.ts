import { Router } from 'express';
import {
  listContainers,
  getContainerStats,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerLogs,
  execInContainer,
  inspectContainer,
  listImages,
  pullImage,
  removeImage,
  checkDockerInstalled,
} from '../services/docker.js';

const router = Router();

// Check if Docker is installed
router.get('/check/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const isInstalled = await checkDockerInstalled(sessionId);
    res.json({ success: true, data: { installed: isInstalled } });
  } catch (error: any) {
    console.error('Docker check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List containers
router.get('/containers/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { all = 'true' } = req.query;
    const containers = await listContainers(sessionId, all === 'true');
    res.json({ success: true, data: containers });
  } catch (error: any) {
    console.error('List containers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get container stats
router.get('/stats/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { containerId } = req.query;
    const stats = await getContainerStats(sessionId, containerId as string | undefined);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('Container stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start container
router.post('/containers/:sessionId/:containerId/start', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    await startContainer(sessionId, containerId);
    res.json({ success: true, message: 'Container started' });
  } catch (error: any) {
    console.error('Start container error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop container
router.post('/containers/:sessionId/:containerId/stop', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    await stopContainer(sessionId, containerId);
    res.json({ success: true, message: 'Container stopped' });
  } catch (error: any) {
    console.error('Stop container error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restart container
router.post('/containers/:sessionId/:containerId/restart', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    await restartContainer(sessionId, containerId);
    res.json({ success: true, message: 'Container restarted' });
  } catch (error: any) {
    console.error('Restart container error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove container
router.delete('/containers/:sessionId/:containerId', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    const { force = 'false' } = req.query;
    await removeContainer(sessionId, containerId, force === 'true');
    res.json({ success: true, message: 'Container removed' });
  } catch (error: any) {
    console.error('Remove container error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get container logs
router.get('/containers/:sessionId/:containerId/logs', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    const { tail = '100' } = req.query;
    const logs = await getContainerLogs(sessionId, containerId, parseInt(tail as string));
    res.json({ success: true, data: logs });
  } catch (error: any) {
    console.error('Container logs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute command in container
router.post('/containers/:sessionId/:containerId/exec', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ success: false, error: 'Command is required' });
    }

    const output = await execInContainer(sessionId, containerId, command);
    res.json({ success: true, data: output });
  } catch (error: any) {
    console.error('Exec in container error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Inspect container
router.get('/containers/:sessionId/:containerId/inspect', async (req, res) => {
  try {
    const { sessionId, containerId } = req.params;
    const info = await inspectContainer(sessionId, containerId);
    res.json({ success: true, data: info });
  } catch (error: any) {
    console.error('Inspect container error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List images
router.get('/images/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const images = await listImages(sessionId);
    res.json({ success: true, data: images });
  } catch (error: any) {
    console.error('List images error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pull image
router.post('/images/:sessionId/pull', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { imageName } = req.body;

    if (!imageName) {
      return res.status(400).json({ success: false, error: 'Image name is required' });
    }

    const output = await pullImage(sessionId, imageName);
    res.json({ success: true, data: output });
  } catch (error: any) {
    console.error('Pull image error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove image
router.delete('/images/:sessionId/:imageId', async (req, res) => {
  try {
    const { sessionId, imageId } = req.params;
    const { force = 'false' } = req.query;
    await removeImage(sessionId, imageId, force === 'true');
    res.json({ success: true, message: 'Image removed' });
  } catch (error: any) {
    console.error('Remove image error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
