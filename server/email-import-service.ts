import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as activityStore from './activity-store.js';
import { parseAiImport } from './ai-import-service.js';

let polling = false;

export type EmailImportPollStatus = 'success' | 'no_match' | 'unconfigured' | 'busy' | 'error';

export interface EmailImportPollResult {
  status: EmailImportPollStatus;
  scanned: number;
  matched: number;
  processed: number;
  failed: number;
  message: string;
}

export function extractEmailImportToken(subject: string): string | null {
  return subject.match(/\[AI-IMPORT\s+([a-f0-9]{32})\]/i)?.[1] || null;
}

function result(status: EmailImportPollStatus, message: string, values: Partial<EmailImportPollResult> = {}): EmailImportPollResult {
  return {
    status,
    scanned: values.scanned || 0,
    matched: values.matched || 0,
    processed: values.processed || 0,
    failed: values.failed || 0,
    message,
  };
}

export async function pollEmailImports(options: {
  model: string;
  resolveApiKey: (userId: string) => string | null;
  onlyUserId?: string;
  log?: (message: string, error?: unknown) => void;
}): Promise<EmailImportPollResult> {
  if (polling) return result('busy', '邮箱正在检查中，请稍后再试');
  if (!process.env.IMAP_PASS || !process.env.IMAP_USER) {
    return result('unconfigured', '服务端尚未配置 IMAP_USER 和 IMAP_PASS');
  }

  polling = true;
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.163.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS },
    logger: false,
  });
  let scanned = 0;
  let matched = 0;
  let processed = 0;
  let failed = 0;
  let lastError = '';

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // 先完整读取消息，再逐封处理。ImapFlow 的 fetch() 流尚未结束时不能
      // 在循环内发送 messageFlagsAdd()，否则两个 IMAP 命令会互相等待。
      const messages = await client.fetchAll({ seen: false }, { uid: true, envelope: true, source: true });
      for (const message of messages) {
        scanned++;
        const token = extractEmailImportToken(message.envelope?.subject || '');
        if (!token || !message.source) continue;
        const userId = activityStore.findUserByImportToken(token);
        if (!userId || (options.onlyUserId && userId !== options.onlyUserId)) continue;
        matched++;

        try {
          const parsed = await simpleParser(message.source);
          const messageId = parsed.messageId || message.envelope?.messageId || 'uid:' + message.uid;
          if (activityStore.isEmailProcessed(messageId)) {
            try {
              await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
            } catch {
              options.log?.('邮件已经处理，但暂时无法更新为已读状态');
            }
            continue;
          }
          const apiKey = options.resolveApiKey(userId);
          if (!apiKey) throw new Error('当前用户未配置 AI API Key');

          const images = (parsed.attachments || [])
            .filter(item => ['image/jpeg', 'image/png', 'image/webp'].includes(item.contentType) && item.content.length <= 8 * 1024 * 1024)
            .slice(0, 3)
            .map(item => ({
              name: item.filename || 'email-image',
              mimeType: item.contentType as 'image/jpeg' | 'image/png' | 'image/webp',
              base64: item.content.toString('base64'),
            }));
          const text = [parsed.subject, parsed.text].filter(Boolean).join('\n\n').slice(0, 20_000);
          const draft = await parseAiImport({ text, images, apiKey, model: options.model });
          const record = activityStore.createAiImport({ userId, sourceType: 'email', inputText: text, draft });
          activityStore.markEmailProcessed(messageId, userId, record.id);
          processed++;
          try {
            await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          } catch {
            options.log?.('草稿已经生成，但暂时无法将原邮件更新为已读状态');
          }
          options.log?.('邮箱导入草稿已生成: ' + draft.title);
        } catch (error) {
          failed++;
          lastError = error instanceof Error ? error.message : String(error);
          options.log?.('邮箱导入邮件处理失败', error);
        }
      }
    } finally {
      lock.release();
    }

    if (processed > 0) return result('success', `已生成 ${processed} 个待确认草稿`, { scanned, matched, processed, failed });
    if (matched === 0) return result('no_match', '没有找到包含当前导入令牌的未读邮件', { scanned });
    if (failed > 0) return result('error', '找到邮件，但识别失败：' + lastError, { scanned, matched, failed });
    return result('no_match', '匹配邮件已经处理过，没有生成新的草稿', { scanned, matched });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log?.('邮箱自动导入失败', error);
    return result('error', '邮箱连接失败：' + message, { scanned, matched, processed, failed });
  } finally {
    await client.logout().catch(() => undefined);
    polling = false;
  }
}
