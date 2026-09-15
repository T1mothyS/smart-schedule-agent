import { Router, type RequestHandler } from 'express';
import { getAiLinkageGuides } from '../ai-linkage-guide.js';

export function createGuidesRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  app.get('/api/ai-linkage-guides', authenticate, (_req, res) => {
    res.json(getAiLinkageGuides());
  });


  return app;
}
