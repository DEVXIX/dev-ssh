import { Router } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';
import { scheduleTask, stopTask, executeTask, reloadTask } from '../services/taskScheduler.js';
import cron from 'node-cron';

const router = Router();
const db = getDatabase();

// Get all tasks for user
router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { connectionId } = req.query;

    let query = 'SELECT t.*, c.name as connection_name, c.host FROM scheduled_tasks t LEFT JOIN connections c ON t.connection_id = c.id WHERE t.user_id = ?';
    const params: any[] = [userId];

    if (connectionId) {
      query += ' AND t.connection_id = ?';
      params.push(connectionId);
    }

    query += ' ORDER BY t.created_at DESC';

    const tasks = db.prepare(query).all(...params);

    res.json({ success: true, data: tasks });
  } catch (error: any) {
    console.error('[Tasks] Get tasks error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single task
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { id } = req.params;

    const task = db.prepare(`
      SELECT t.*, c.name as connection_name, c.host
      FROM scheduled_tasks t
      LEFT JOIN connections c ON t.connection_id = c.id
      WHERE t.id = ? AND t.user_id = ?
    `).get(id, userId);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    res.json({ success: true, data: task });
  } catch (error: any) {
    console.error('[Tasks] Get task error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create task
router.post('/', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { connectionId, name, description, command, schedule, timezone, enabled } = req.body;

    if (!connectionId || !name || !command || !schedule) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Verify connection belongs to user
    const connection = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(connectionId, userId);
    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    // Validate cron expression
    if (!cron.validate(schedule)) {
      return res.status(400).json({ success: false, error: 'Invalid cron expression' });
    }

    const result = db.prepare(`
      INSERT INTO scheduled_tasks (connection_id, user_id, name, description, command, schedule, timezone, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(connectionId, userId, name, description || null, command, schedule, timezone || 'UTC', enabled !== false ? 1 : 0);

    const taskId = result.lastInsertRowid as number;

    // Schedule the task if enabled
    if (enabled !== false) {
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;
      scheduleTask(task);
    }

    const newTask = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);

    res.json({ success: true, data: newTask });
  } catch (error: any) {
    console.error('[Tasks] Create task error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update task
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { id } = req.params;
    const { name, description, command, schedule, timezone, enabled } = req.body;

    // Verify task belongs to user
    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(id, userId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Validate cron expression if provided
    if (schedule && !cron.validate(schedule)) {
      return res.status(400).json({ success: false, error: 'Invalid cron expression' });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (command !== undefined) {
      updates.push('command = ?');
      params.push(command);
    }
    if (schedule !== undefined) {
      updates.push('schedule = ?');
      params.push(schedule);
    }
    if (timezone !== undefined) {
      updates.push('timezone = ?');
      params.push(timezone);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Reload the task
    reloadTask(Number(id));

    const updatedTask = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);

    res.json({ success: true, data: updatedTask });
  } catch (error: any) {
    console.error('[Tasks] Update task error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete task
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { id } = req.params;

    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(id, userId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Stop the task first
    stopTask(Number(id));

    // Delete task (logs will be cascade deleted)
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Tasks] Delete task error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute task now (manual run)
router.post('/:id/execute', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { id } = req.params;

    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(id, userId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Execute task asynchronously
    const result = await executeTask(Number(id));

    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[Tasks] Execute task error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get task logs
router.get('/:id/logs', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    // Verify task belongs to user
    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(id, userId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const logs = db.prepare(`
      SELECT * FROM task_logs
      WHERE task_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(id, limit);

    res.json({ success: true, data: logs });
  } catch (error: any) {
    console.error('[Tasks] Get logs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Validate cron expression
router.post('/validate-cron', async (req, res) => {
  try {
    const { expression } = req.body;

    if (!expression) {
      return res.status(400).json({ success: false, error: 'Expression is required' });
    }

    const isValid = cron.validate(expression);

    res.json({ success: true, valid: isValid });
  } catch (error: any) {
    console.error('[Tasks] Validate cron error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
