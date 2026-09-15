import express, { Router, type RequestHandler } from 'express';
import type { JwtPayload } from '../auth.js';
import * as libraryService from '../library-service.js';
import { authenticateLibraryPublishToken, generateLibraryPublishToken, getLibraryPublishTokenStatus, revokeLibraryPublishToken } from '../library-publish-token-service.js';

function sendLibraryError(res: express.Response, error: unknown, fallback: string, status = 400): void {
  if (error instanceof libraryService.LibraryInputError) {
    res.status(status).json({
      success: false,
      error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) },
    });
    return;
  }
  res.status(status).json({ success: false, error: { code: 'LIBRARY_ERROR', message: error instanceof Error ? error.message : fallback } });
}

function sendLibraryMutation(res: express.Response, result: libraryService.LibraryMutationResult, status?: number): void {
  res.status(status ?? (result.status === 'CREATED' ? 201 : 200)).json({
    success: true,
    status: result.status,
    entry: result.entry,
    normalizedFields: result.normalizedFields,
    warnings: result.warnings,
    relations: {
      items: result.entry.relations,
      calendarEvents: [],
      libraryEntries: result.entry.relations.map(item => item.targetSourceId),
    },
    detailPath: `/library/${result.entry.id}`,
  });
}


export function createLibraryRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  const libraryCreateFields = [
    'kind', 'type', 'sourceId', 'externalId', 'slug', 'title', 'content', 'summary', 'tags', 'status',
    'sourceType', 'sourceRef', 'sourceUrl', 'metadata', 'relations',
  ];

  function libraryBody(req: express.Request): Record<string, unknown> {
    return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  }

  app.get('/api/library/preferences', authenticate, (req, res) => {
    try {
      const userId = ((req as any).user as JwtPayload).userId;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, preference: libraryService.getLibrarySortPreference(userId) });
    } catch (error) {
      sendLibraryError(res, error, '获取知识库排序偏好失败', 500);
    }
  });

  app.put('/api/library/preferences', authenticate, (req, res) => {
    try {
      const body = libraryBody(req);
      const unknownFields = Object.keys(body).filter(key => key !== 'sort');
      if (unknownFields.length) return res.status(400).json({ success: false, error: { code: 'UNKNOWN_FIELD', message: `不允许的字段：${unknownFields.join(', ')}` } });
      if (!libraryService.isLibrarySort(body.sort)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SORT', message: 'sort 不合法', field: 'sort' } });
      }
      const userId = ((req as any).user as JwtPayload).userId;
      const preference = libraryService.saveLibrarySortPreference(userId, body.sort);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, preference });
    } catch (error) {
      sendLibraryError(res, error, '保存知识库排序偏好失败', 500);
    }
  });

  app.get('/api/library', authenticate, (req, res) => {
    try {
      const userId = ((req as any).user as JwtPayload).userId;
      const kind = String(req.query.kind || 'all');
      const type = String(req.query.type || 'all');
      const status = String(req.query.status || 'active');
      const requestedSort = req.query.sort === undefined ? undefined : String(req.query.sort);
      const sort = requestedSort === undefined ? libraryService.getLibrarySortPreference(userId).sort : requestedSort;
      const allowedKind = ['all', ...libraryService.LIBRARY_KINDS];
      const allowedType = ['all', ...libraryService.LIBRARY_TYPES];
      const allowedStatus = ['all', ...libraryService.LIBRARY_STATUSES];
      if (!allowedKind.includes(kind)) return res.status(400).json({ success: false, error: { code: 'INVALID_KIND', message: 'kind 不合法', field: 'kind' } });
      if (!allowedType.includes(type)) return res.status(400).json({ success: false, error: { code: 'INVALID_TYPE', message: 'type 不合法', field: 'type' } });
      if (!allowedStatus.includes(status)) return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'status 不合法', field: 'status' } });
      if (!libraryService.isLibrarySort(sort)) return res.status(400).json({ success: false, error: { code: 'INVALID_SORT', message: 'sort 不合法', field: 'sort' } });
      res.setHeader('Cache-Control', 'no-store');
      const result = libraryService.listLibraryEntries(userId, {
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        kind,
        type,
        status,
        tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
        sourceType: typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined,
        page: Number(req.query.page || 1),
        pageSize: Number(req.query.pageSize || 40),
        sort,
      });
      res.json({ success: true, sort, ...result });
    } catch (error) {
      sendLibraryError(res, error, '获取知识库失败', 500);
    }
  });

  const getLibraryPublishTokenHandler = (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: getLibraryPublishTokenStatus((req as any).user.userId) });
  };

  app.get('/api/library/publish-token', authenticate, getLibraryPublishTokenHandler);
  app.get('/api/integrations/library-token', authenticate, getLibraryPublishTokenHandler);

  const generateLibraryPublishTokenHandler = (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const generated = generateLibraryPublishToken((req as any).user.userId);
    res.json({
      token: generated.token,
      status: generated.status,
      warning: '令牌明文只显示这一次，请立即保存到迁移脚本或其他本地私密配置。',
    });
  };

  app.post('/api/library/publish-token', authenticate, generateLibraryPublishTokenHandler);
  app.post('/api/integrations/library-token', authenticate, generateLibraryPublishTokenHandler);

  const revokeLibraryPublishTokenHandler = (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: revokeLibraryPublishToken((req as any).user.userId) });
  };

  app.delete('/api/library/publish-token', authenticate, revokeLibraryPublishTokenHandler);
  app.delete('/api/integrations/library-token', authenticate, revokeLibraryPublishTokenHandler);

  // 本地 Markdown 发布脚本使用独立的、仅限知识库写入的令牌，不拥有登录会话权限。
  const publishLibraryHandler = (req: express.Request, res: express.Response) => {
    const authorization = String(req.header('authorization') || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const authenticated = match ? authenticateLibraryPublishToken(match[1].trim()) : null;
    if (!authenticated) return res.status(401).json({ success: false, error: { code: 'INVALID_PUBLISH_TOKEN', message: '知识库发布令牌无效或已经撤销' } });
    try {
      const body = libraryBody(req);
      const unknownFields = Object.keys(body).filter(key => !libraryCreateFields.includes(key));
      if (unknownFields.length) return res.status(400).json({ success: false, error: { code: 'UNKNOWN_FIELD', message: `不允许的字段：${unknownFields.join(', ')}` } });
      sendLibraryMutation(res, libraryService.publishLibraryArticle(authenticated.userId, body));
    } catch (error) {
      sendLibraryError(res, error, '发布知识失败');
    }
  };

  app.post('/api/library/publish', publishLibraryHandler);
  app.post('/api/integrations/library', publishLibraryHandler);

  const libraryLifecycleFields = ['sourceIds', 'confirm'];
  const libraryLifecycleActions = ['retire', 'restore', 'purge'] as const;

  function publishLibraryLifecycleHandler(action: (typeof libraryLifecycleActions)[number]) {
    return (req: express.Request, res: express.Response) => {
      const authorization = String(req.header('authorization') || '');
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      const authenticated = match ? authenticateLibraryPublishToken(match[1].trim()) : null;
      if (!authenticated) return res.status(401).json({ success: false, error: { code: 'INVALID_PUBLISH_TOKEN', message: '知识库发布令牌无效或已经撤销' } });
      try {
        const body = libraryBody(req);
        const unknownFields = Object.keys(body).filter(key => !libraryLifecycleFields.includes(key));
        if (unknownFields.length) return res.status(400).json({ success: false, error: { code: 'UNKNOWN_FIELD', message: `不允许的字段：${unknownFields.join(', ')}` } });
        if (!Array.isArray(body.sourceIds)) return res.status(400).json({ success: false, error: { code: 'INVALID_SOURCE_IDS', message: 'sourceIds 必须是非空字符串数组', field: 'sourceIds' } });
        const sourceIds = [...new Set(body.sourceIds.map(value => String(value || '').trim()).filter(Boolean))];
        if (!sourceIds.length || sourceIds.length > 100) return res.status(400).json({ success: false, error: { code: 'INVALID_SOURCE_IDS', message: 'sourceIds 数量必须在 1 到 100 之间', field: 'sourceIds' } });
        if (action === 'purge' && body.confirm !== true) return res.status(400).json({ success: false, error: { code: 'PURGE_CONFIRMATION_REQUIRED', message: '彻底清除必须显式提供 confirm: true', field: 'confirm' } });
        const result = libraryService.applyLibraryLifecycle(authenticated.userId, sourceIds, action);
        res.json({ success: true, ...result });
      } catch (error) {
        sendLibraryError(res, error, `知识库${action}操作失败`);
      }
    };
  }

  for (const action of libraryLifecycleActions) {
    app.post(`/api/library/publish/${action}`, publishLibraryLifecycleHandler(action));
    app.post(`/api/integrations/library/${action}`, publishLibraryLifecycleHandler(action));
  }

  function sendReadOnlyLibraryError(res: express.Response): void {
    res.status(405).setHeader('Allow', 'GET, POST /comments, DELETE /comments/:commentId').json({
      success: false,
      error: {
        code: 'READ_ONLY_LIBRARY',
        message: '知识正文只能在本地知识库 V2 加工后通过发布令牌写入；网页端仅支持查看、评论和导出。',
      },
    });
  }

  app.post('/api/library', authenticate, (_req, res) => sendReadOnlyLibraryError(res));

  app.get('/api/library/export', authenticate, (req, res) => {
    const bundle = libraryService.exportLibraryBundle((req as any).user.userId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('library-export.json')}`);
    res.json(bundle);
  });

  app.get('/api/library/:id/versions', authenticate, (req, res) => {
    const detail = libraryService.getLibraryDetail((req as any).user.userId, req.params.id);
    if (!detail) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '知识不存在或无权访问' } });
    res.json({ success: true, versions: detail.versions });
  });

  app.get('/api/library/:id/export', authenticate, (req, res) => {
    const exported = libraryService.exportLibraryEntryMarkdown((req as any).user.userId, req.params.id);
    if (!exported) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '知识不存在或无权访问' } });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
    res.send(exported.markdown);
  });

  app.post('/api/library/:id/promote', authenticate, (_req, res) => sendReadOnlyLibraryError(res));

  app.post('/api/library/:id/archive', authenticate, (_req, res) => sendReadOnlyLibraryError(res));

  app.get('/api/library/:id/comments', authenticate, (req, res) => {
    const detail = libraryService.getLibraryDetail((req as any).user.userId, req.params.id);
    if (!detail) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '知识不存在或无权访问' } });
    res.json({ success: true, comments: detail.comments });
  });

  app.post('/api/library/:id/comments', authenticate, (req, res) => {
    try {
      const comment = libraryService.addLibraryComment((req as any).user.userId, req.params.id, libraryBody(req).content);
      if (!comment) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '知识不存在或无权访问' } });
      res.status(201).json({ success: true, comment });
    } catch (error) {
      sendLibraryError(res, error, '添加评论失败');
    }
  });

  app.delete('/api/library/:id/comments/:commentId', authenticate, (req, res) => {
    const deleted = libraryService.deleteLibraryComment((req as any).user.userId, req.params.id, req.params.commentId);
    if (!deleted) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '评论不存在或无权访问' } });
    res.json({ success: true });
  });

  app.get('/api/library/:id', authenticate, (req, res) => {
    const detail = libraryService.getLibraryDetail((req as any).user.userId, req.params.id);
    if (!detail) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '知识不存在或无权访问' } });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...detail });
  });

  app.patch('/api/library/:id', authenticate, (_req, res) => sendReadOnlyLibraryError(res));

  app.delete('/api/library/:id', authenticate, (_req, res) => sendReadOnlyLibraryError(res));


  return app;
}
