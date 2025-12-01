import { Router, Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import type { Workspace, WorkspacePane } from '../../types/index.js';

const router = Router();
const db = getDatabase();

// Get all workspaces for the current user
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const workspaces = db.prepare(`
      SELECT * FROM workspaces
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(userId) as any[];

    const formattedWorkspaces: Workspace[] = workspaces.map(ws => ({
      id: ws.id,
      userId: ws.user_id,
      name: ws.name,
      description: ws.description,
      layout: ws.layout,
      panes: JSON.parse(ws.panes),
      createdAt: ws.created_at,
      updatedAt: ws.updated_at,
    }));

    res.json({ success: true, data: formattedWorkspaces });
  } catch (error: any) {
    console.error('Failed to get workspaces:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve workspaces' });
  }
});

// Get a single workspace
router.get('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const workspaceId = parseInt(req.params.id);

    const workspace = db.prepare(`
      SELECT * FROM workspaces
      WHERE id = ? AND user_id = ?
    `).get(workspaceId, userId) as any;

    if (!workspace) {
      return res.status(404).json({ success: false, error: 'Workspace not found' });
    }

    const formattedWorkspace: Workspace = {
      id: workspace.id,
      userId: workspace.user_id,
      name: workspace.name,
      description: workspace.description,
      layout: workspace.layout,
      panes: JSON.parse(workspace.panes),
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
    };

    res.json({ success: true, data: formattedWorkspace });
  } catch (error: any) {
    console.error('Failed to get workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve workspace' });
  }
});

// Create a new workspace
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { name, description, layout, panes } = req.body;

    // Validate required fields
    if (!name || !layout || !panes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, layout, panes'
      });
    }

    // Validate layout type
    const validLayouts = ['single', 'horizontal-2', 'vertical-2', 'main-vertical', 'main-horizontal', 'grid-4'];
    if (!validLayouts.includes(layout)) {
      return res.status(400).json({
        success: false,
        error: `Invalid layout type. Must be one of: ${validLayouts.join(', ')}`
      });
    }

    // Insert workspace
    const result = db.prepare(`
      INSERT INTO workspaces (user_id, name, description, layout, panes)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name, description || null, layout, JSON.stringify(panes));

    const newWorkspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(result.lastInsertRowid) as any;

    const formattedWorkspace: Workspace = {
      id: newWorkspace.id,
      userId: newWorkspace.user_id,
      name: newWorkspace.name,
      description: newWorkspace.description,
      layout: newWorkspace.layout,
      panes: JSON.parse(newWorkspace.panes),
      createdAt: newWorkspace.created_at,
      updatedAt: newWorkspace.updated_at,
    };

    res.status(201).json({ success: true, data: formattedWorkspace });
  } catch (error: any) {
    console.error('Failed to create workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to create workspace' });
  }
});

// Update a workspace
router.put('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const workspaceId = parseInt(req.params.id);
    const { name, description, layout, panes } = req.body;

    // Check if workspace exists and belongs to user
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ? AND user_id = ?').get(workspaceId, userId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Workspace not found' });
    }

    // Update workspace
    db.prepare(`
      UPDATE workspaces
      SET name = ?, description = ?, layout = ?, panes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(name, description || null, layout, JSON.stringify(panes), workspaceId, userId);

    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as any;

    const formattedWorkspace: Workspace = {
      id: updated.id,
      userId: updated.user_id,
      name: updated.name,
      description: updated.description,
      layout: updated.layout,
      panes: JSON.parse(updated.panes),
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };

    res.json({ success: true, data: formattedWorkspace });
  } catch (error: any) {
    console.error('Failed to update workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to update workspace' });
  }
});

// Delete a workspace
router.delete('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const workspaceId = parseInt(req.params.id);

    const result = db.prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?').run(workspaceId, userId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Workspace not found' });
    }

    res.json({ success: true, message: 'Workspace deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to delete workspace' });
  }
});

export default router;
