import { Router, type RequestHandler } from 'express';
import * as noteItemService from '../note-item-service.js';

export function createNotesRouter({ authenticate }: { authenticate: RequestHandler }) {
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
      const unknownFields = Object.keys(body).filter(key => !['content', 'completed', 'color'].includes(key));
      if (unknownFields.length) return res.status(400).json({ error: '只允许修改记事内容、完成状态或颜色' });
      const item = noteItemService.updateNoteItem(userId, req.params.id, body);
      if (!item) return res.status(404).json({ error: '记事不存在或无权访问' });
      res.json({ item });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '更新记事失败' });
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
