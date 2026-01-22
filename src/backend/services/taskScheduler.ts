import cron from 'node-cron';
import { getDatabase } from '../database/init.js';
import { executeSSHCommand } from './ssh.js';

interface ScheduledTask {
  id: number;
  connectionId: number;
  userId: number;
  name: string;
  description?: string;
  command: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  lastStatus?: string;
  lastOutput?: string;
  lastError?: string;
  runCount: number;
}

interface TaskJob {
  task: ScheduledTask;
  cronJob: cron.ScheduledTask;
}

const activeTasks = new Map<number, TaskJob>();
const db = getDatabase();

/**
 * Initialize the task scheduler - load and start all enabled tasks
 */
export function initTaskScheduler() {
  console.log('[TaskScheduler] Initializing task scheduler...');

  try {
    const tasks = db.prepare(`
      SELECT * FROM scheduled_tasks WHERE enabled = 1
    `).all() as ScheduledTask[];

    console.log(`[TaskScheduler] Found ${tasks.length} enabled tasks`);

    for (const task of tasks) {
      try {
        scheduleTask(task);
      } catch (error: any) {
        console.error(`[TaskScheduler] Failed to schedule task ${task.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[TaskScheduler] Failed to initialize task scheduler:', error);
  }
}

/**
 * Schedule a task
 */
export function scheduleTask(task: ScheduledTask) {
  // Validate cron expression
  if (!cron.validate(task.schedule)) {
    throw new Error(`Invalid cron expression: ${task.schedule}`);
  }

  // Stop existing task if running
  stopTask(task.id);

  console.log(`[TaskScheduler] Scheduling task ${task.id}: ${task.name} (${task.schedule})`);

  const cronJob = cron.schedule(
    task.schedule,
    async () => {
      await executeTask(task.id);
    },
    {
      scheduled: true,
      timezone: task.timezone || 'UTC',
    }
  );

  activeTasks.set(task.id, { task, cronJob });
}

/**
 * Stop a scheduled task
 */
export function stopTask(taskId: number) {
  const activeTask = activeTasks.get(taskId);
  if (activeTask) {
    console.log(`[TaskScheduler] Stopping task ${taskId}`);
    activeTask.cronJob.stop();
    activeTasks.delete(taskId);
  }
}

/**
 * Execute a task immediately
 */
export async function executeTask(taskId: number): Promise<{
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
}> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  console.log(`[TaskScheduler] Executing task ${taskId}`);

  try {
    // Get task details (note: DB returns snake_case columns)
    const taskRow = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

    if (!taskRow) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Get connection details
    const connection = db.prepare('SELECT * FROM connections WHERE id = ?').get(taskRow.connection_id) as any;

    if (!connection) {
      throw new Error(`Connection ${taskRow.connection_id} not found`);
    }

    if (connection.type !== 'ssh') {
      throw new Error(`Task execution only supported for SSH connections`);
    }

    // Log start
    const logId = db.prepare(`
      INSERT INTO task_logs (task_id, status, started_at)
      VALUES (?, 'running', ?)
    `).run(taskId, startedAt).lastInsertRowid;

    // Execute command via SSH
    const result = await executeSSHCommand(
      connection.id,
      taskRow.user_id,
      taskRow.command
    );

    const endTime = Date.now();
    const duration = endTime - startTime;
    const completedAt = new Date().toISOString();

    // Update log
    db.prepare(`
      UPDATE task_logs
      SET status = ?, output = ?, completed_at = ?, duration_ms = ?
      WHERE id = ?
    `).run('success', result.output, completedAt, duration, logId);

    // Update task
    db.prepare(`
      UPDATE scheduled_tasks
      SET last_run = ?, last_status = 'success', last_output = ?, last_error = NULL, run_count = run_count + 1
      WHERE id = ?
    `).run(completedAt, result.output?.substring(0, 5000), taskId);

    console.log(`[TaskScheduler] Task ${taskId} completed successfully in ${duration}ms`);

    return {
      success: true,
      output: result.output,
      duration,
    };
  } catch (error: any) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const completedAt = new Date().toISOString();
    const errorMessage = error.message || 'Unknown error';

    console.error(`[TaskScheduler] Task ${taskId} failed:`, errorMessage);

    // Update log if exists
    const log = db.prepare('SELECT id FROM task_logs WHERE task_id = ? AND status = ?').get(taskId, 'running') as any;
    if (log) {
      db.prepare(`
        UPDATE task_logs
        SET status = 'error', error = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `).run(errorMessage, completedAt, duration, log.id);
    } else {
      // Create error log
      db.prepare(`
        INSERT INTO task_logs (task_id, status, error, started_at, completed_at, duration_ms)
        VALUES (?, 'error', ?, ?, ?, ?)
      `).run(taskId, errorMessage, startedAt, completedAt, duration);
    }

    // Update task
    db.prepare(`
      UPDATE scheduled_tasks
      SET last_run = ?, last_status = 'error', last_error = ?
      WHERE id = ?
    `).run(completedAt, errorMessage.substring(0, 1000), taskId);

    return {
      success: false,
      error: errorMessage,
      duration,
    };
  }
}

/**
 * Get all active tasks
 */
export function getActiveTasks() {
  return Array.from(activeTasks.values()).map(({ task }) => ({
    id: task.id,
    name: task.name,
    schedule: task.schedule,
    nextRun: task.nextRun,
  }));
}

/**
 * Reload a task (stop and restart)
 */
export function reloadTask(taskId: number) {
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as ScheduledTask | undefined;

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.enabled) {
    scheduleTask(task);
  } else {
    stopTask(taskId);
  }
}

/**
 * Stop all tasks (for graceful shutdown)
 */
export function stopAllTasks() {
  console.log('[TaskScheduler] Stopping all tasks...');
  for (const [taskId, { cronJob }] of activeTasks.entries()) {
    cronJob.stop();
  }
  activeTasks.clear();
}
