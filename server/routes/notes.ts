import { Router, type RequestHandler } from 'express';
import * as noteItemService from '../note-item-service.js';
import { OptimizeError } from '../prompt-optimize.js';
import { createPromptOptimizationRunId, runPromptOptimization, type PromptOptimizationRun } from '../note-prompt-optimization.js';
import { addLog } from '../log-service.js';

export function createNotesRouter({
  authenticate,
  optimizePrompt = runPromptOptimization,
}: {
  authenticate: RequestHandler;
  optimizePrompt?: (userId: string, text: unknown, controller: AbortController, runId?: string) => Promise<PromptOptimizationRun>;
}) {
  const app = Router();
  app.get('/api/note-items', authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ items: noteItemService.listNoteItems(userId) });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || '获取记事失败' });
    }
  });

  app.post('/api/note-items', authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const input = body.contents !== undefined ? body.contents : body.content;
      const items = noteItemService.createNoteItems(userId, input, body.color === undefined ? 'neutral' : body.color);
      res.status(201).json({ items });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存记事失败' });
    }
  });

  app.patch('/api/note-items/:id', authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const unknownFields = Object.keys(body).filter(key => !['content', 'completed', 'color', 'expectedContent', 'expectedRevision'].includes(key));
      if (unknownFields.length) return res.status(400).json({ error: '只允许修改记事内容、完成状态或颜色' });
      if (body.expectedContent !== undefined && (typeof body.expectedContent !== 'string' || typeof body.content !== 'string')) return res.status(400).json({ error: '原文校验必须与正文一起提交' });
      if (body.expectedRevision !== undefined && (body.content === undefined || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)) return res.status(400).json({ error: '正文版本校验必须与正文一起提交' });
      const item = noteItemService.updateNoteItem(userId, req.params.id, body);
      if (!item) return res.status(404).json({ error: '记事不存在或无权访问' });
      res.json({ item });
    } catch (error: any) {
      res.status(error instanceof noteItemService.NoteContentConflict ? 409 : 400).json({ error: error?.message || '更新记事失败' });
    }
  });

  app.post('/api/note-items/:id/optimize', authenticate, async (req, res) => {
    const controller = new AbortController();
    const runId = createPromptOptimizationRunId();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      const userId = (req as any).user.userId;
      const snapshot = readOptimizationSnapshot(req.body);
      const note = noteItemService.getNoteItem(userId, req.params.id);
      if (!note) return res.status(404).json({ error: '记事不存在或无权访问' });
      if (note.content !== snapshot.expectedContent || note.contentRevision !== snapshot.expectedRevision) throw new noteItemService.NoteContentConflict();
      if (note.isOptimized) throw new noteItemService.NoteOptimizationConflict('ALREADY_OPTIMIZED', '这条记事已经优化，请先撤回后再优化。');
      const run = await optimizePrompt(userId, note.content, controller, runId);
      const item = noteItemService.commitOptimizedNote(userId, note.id, snapshot.expectedContent, snapshot.expectedRevision, run.optimizedText);
      if (!item) throw new noteItemService.NoteContentConflict();
      addLog('info', 'ai', '记事提示词优化完成', {
        runId: run.runId || runId,
        noteId: note.id,
        textLength: run.input.length,
        resultLength: run.optimizedText.length,
        optimizationCount: item.optimizationCount,
      });
      if (!res.destroyed) res.setHeader('Cache-Control', 'no-store').json({ item });
    } catch (error) {
      const status = controller.signal.aborted
        ? 504
        : error instanceof noteItemService.NoteContentConflict || error instanceof noteItemService.NoteOptimizationConflict
          ? 409
          : error instanceof OptimizeError ? error.status : 502;
      addLog('warn', 'ai', '记事提示词优化失败', { runId, status });
      if (!res.destroyed) res.status(status).json({ error: controller.signal.aborted ? '优化已取消或超时，请重试' : error instanceof Error ? error.message : 'AI 优化失败，请重试' });
    } finally {
      clearTimeout(timeout);
      res.off('close', disconnect);
    }
  });

  app.post('/api/note-items/:id/revert-optimization', authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const snapshot = readOptimizationSnapshot(req.body);
      const item = noteItemService.revertOptimizedNote(userId, req.params.id, snapshot.expectedContent, snapshot.expectedRevision);
      if (!item) return res.status(404).json({ error: '记事不存在或无权访问' });
      res.setHeader('Cache-Control', 'no-store').json({ item });
    } catch (error) {
      const status = error instanceof noteItemService.NoteContentConflict || error instanceof noteItemService.NoteOptimizationConflict ? 409 : 400;
      res.status(status).json({ error: error instanceof Error ? error.message : '撤回优化失败，请重试' });
    }
  });

  app.post('/api/note-items/:id/merge', authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const unknownFields = Object.keys(body).filter(key => key !== 'targetId');
      if (unknownFields.length) return res.status(400).json({ error: '合并记事只需要 targetId' });
      if (typeof body.targetId !== 'string' || !body.targetId.trim()) return res.status(400).json({ error: '目标记事不正确' });
      const merged = noteItemService.mergeNoteItems(userId, req.params.id, body.targetId.trim());
      if (!merged) return res.status(404).json({ error: '来源或目标记事不存在或无权访问' });
      res.json(merged);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '合并记事失败' });
    }
  });

  app.delete('/api/note-items/:id', authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const deleted = noteItemService.deleteNoteItem(userId, req.params.id);
      if (!deleted) return res.status(404).json({ error: '记事不存在或无权访问' });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '删除记事失败' });
    }
  });


  return app;
}

function readOptimizationSnapshot(value: unknown): { expectedContent: string; expectedRevision: number } {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const unknownFields = Object.keys(body).filter(key => !['expectedContent', 'expectedRevision'].includes(key));
  if (unknownFields.length) throw new Error('优化操作只需要 expectedContent 和 expectedRevision');
  if (typeof body.expectedContent !== 'string' || !body.expectedContent.trim()) throw new Error('原文校验正文不正确');
  if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new Error('正文版本校验不正确');
  return { expectedContent: body.expectedContent, expectedRevision: Number(body.expectedRevision) };
}
