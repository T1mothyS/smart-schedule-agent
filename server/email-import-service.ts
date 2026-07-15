import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as activityStore from './activity-store.js';
import { parseAiImport } from './ai-import-service.js';

let polling = false;

export async function pollEmailImports(options: {
  model: string;
  resolveApiKey: (userId: string) => string | null;
  log?: (message: string, error?: unknown) => void;
}): Promise<number> {
  if (polling || !process.env.IMAP_PASS || !process.env.IMAP_USER) return 0;
  polling = true;
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.163.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS },
    logger: false,
  });
  let processed = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const message of client.fetch({ seen: false }, { uid: true, envelope: true, source: true })) {
        const subject = message.envelope?.subject || '';
        const token = subject.match(/\[AI-IMPORT\s+([a-f0-9]{32})\]/i)?.[1];
        if (!token || !message.source) continue;
        const userId = activityStore.findUserByImportToken(token);
        if (!userId) continue;
        const parsed = await simpleParser(message.source);
        const messageId = parsed.messageId || message.envelope?.messageId || 'uid:' + message.uid;
        if (activityStore.isEmailProcessed(messageId)) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          continue;
        }
        const apiKey = options.resolveApiKey(userId);
        if (!apiKey) {
          options.log?.('邮箱导入跳过：用户未配置 AI API Key');
          continue;
        }
        const images = (parsed.attachments || [])
          .filter(item => ['image/jpeg', 'image/png', 'image/webp'].includes(item.contentType))
          .slice(0, 3)
          .map(item => ({ name: item.filename || 'email-image', mimeType: item.contentType as 'image/jpeg' | 'image/png' | 'image/webp', base64: item.content.toString('base64') }));
        const text = [parsed.subject, parsed.text].filter(Boolean).join('\n\n').slice(0, 20_000);
        const draft = await parseAiImport({ text, images, apiKey, model: options.model });
        const record = activityStore.createAiImport({ userId, sourceType: 'email', inputText: text, draft });
        activityStore.markEmailProcessed(messageId, userId, record.id);
        await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
        processed++;
        options.log?.('邮箱导入草稿已生成: ' + draft.title);
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    options.log?.('邮箱自动导入失败', error);
  } finally {
    await client.logout().catch(() => undefined);
    polling = false;
  }
  return processed;
}
