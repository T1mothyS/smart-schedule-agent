import { query, type ImageMediaType, type UserMessage } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';

export interface AiImportImage {
  name: string;
  mimeType: ImageMediaType;
  base64: string;
}

export interface AiImportDraft {
  kind: 'schedule' | 'recurring';
  title: string;
  dueDate: string;
  dueTime: string | null;
  amountCents: number | null;
  currency: string;
  templateKey: 'subscription' | 'insurance' | 'document' | 'membership' | 'rent' | 'utilities' | 'vehicle_inspection' | 'custom';
  recurrence: {
    frequency: 'once' | 'monthly' | 'yearly' | 'interval';
    interval: number;
    unit: 'day' | 'month' | 'year';
    advancePolicy: 'calendar' | 'completion';
  };
  reminderOffsets: number[];
  actionGuide: string;
  notes: string;
  confidence: Record<string, number>;
  warnings: string[];
}

let running = false;

function validateImages(images: AiImportImage[]): void {
  if (images.length > 3) throw new Error('一次最多识别 3 张图片');
  const allowed = new Set<ImageMediaType>(['image/jpeg', 'image/png', 'image/webp']);
  for (const image of images) {
    if (!allowed.has(image.mimeType)) throw new Error('AI 识别只支持 JPEG、PNG 和 WebP 图片');
    const size = Buffer.from(image.base64.replace(/^data:[^;]+;base64,/, ''), 'base64').length;
    if (!size || size > 8 * 1024 * 1024) throw new Error('每张识别图片必须小于 8MB');
  }
}

function extractJson(value: string): any {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 没有返回可解析的草稿');
  return JSON.parse(match[0]);
}

function dateOnly(value: unknown): string {
  const candidate = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : new Date().toISOString().slice(0, 10);
}

function normaliseDraft(raw: any): AiImportDraft {
  const allowedTemplates = ['subscription', 'insurance', 'document', 'membership', 'rent', 'utilities', 'vehicle_inspection', 'custom'];
  const allowedFrequencies = ['once', 'monthly', 'yearly', 'interval'];
  const confidence: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw?.confidence || {})) confidence[key] = Math.min(Math.max(Number(value) || 0, 0), 1);
  const draft: AiImportDraft = {
    kind: raw?.kind === 'recurring' ? 'recurring' : 'schedule',
    title: String(raw?.title || '待确认事项').trim().slice(0, 160),
    dueDate: dateOnly(raw?.dueDate),
    dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(raw?.dueTime) ? raw.dueTime : null,
    amountCents: raw?.amountCents === null || raw?.amountCents === undefined ? null : Math.max(0, Math.round(Number(raw.amountCents))),
    currency: String(raw?.currency || 'CNY').toUpperCase().slice(0, 3),
    templateKey: allowedTemplates.includes(raw?.templateKey) ? raw.templateKey : 'custom',
    recurrence: {
      frequency: allowedFrequencies.includes(raw?.recurrence?.frequency) ? raw.recurrence.frequency : 'once',
      interval: Math.min(Math.max(Number(raw?.recurrence?.interval || 1), 1), 120),
      unit: ['day', 'month', 'year'].includes(raw?.recurrence?.unit) ? raw.recurrence.unit : 'day',
      advancePolicy: raw?.recurrence?.advancePolicy === 'completion' ? 'completion' : 'calendar',
    },
    reminderOffsets: Array.isArray(raw?.reminderOffsets)
      ? [...new Set(raw.reminderOffsets.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 365))]
      : [7, 1],
    actionGuide: String(raw?.actionGuide || '完成事项并登记证明').slice(0, 500),
    notes: String(raw?.notes || '').slice(0, 2000),
    confidence,
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String).slice(0, 10) : [],
  };
  for (const field of ['title', 'dueDate']) {
    if ((draft.confidence[field] ?? 0) < 0.7) draft.warnings.push(field + ' 识别置信度较低，请确认');
  }
  return draft;
}

async function* createPrompt(text: string, images: AiImportImage[]): AsyncGenerator<UserMessage> {
  const content: UserMessage['message']['content'] = [
    {
      type: 'text',
      text: `请从以下文字和图片识别一项日程或周期事务。只输出 JSON，不要 Markdown。
当前日期：${new Date().toISOString().slice(0, 10)}
用户输入：${text || '请识别图片中的账单、到期日和周期'}

JSON 格式：
{
  "kind":"schedule|recurring",
  "title":"事项标题",
  "dueDate":"YYYY-MM-DD",
  "dueTime":"HH:mm|null",
  "amountCents":12345,
  "currency":"CNY",
  "templateKey":"subscription|insurance|document|membership|rent|utilities|vehicle_inspection|custom",
  "recurrence":{"frequency":"once|monthly|yearly|interval","interval":1,"unit":"day|month|year","advancePolicy":"calendar|completion"},
  "reminderOffsets":[30,7,1],
  "actionGuide":"下一步操作",
  "notes":"识别依据摘要",
  "confidence":{"title":0.9,"dueDate":0.9,"amountCents":0.8,"recurrence":0.8},
  "warnings":[]
}
不能确定的字段要降低 confidence 并写入 warnings，禁止编造日期或金额。`,
    },
    ...images.map(image => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mimeType, data: image.base64.replace(/^data:[^;]+;base64,/, '') },
    })),
  ];
  yield {
    type: 'user',
    uuid: uuidv4(),
    session_id: uuidv4(),
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
}

export async function parseAiImport(input: {
  text?: string;
  images?: AiImportImage[];
  apiKey: string;
  model: string;
}): Promise<AiImportDraft> {
  const images = input.images || [];
  validateImages(images);
  if (!input.text?.trim() && images.length === 0) throw new Error('请输入文字或上传账单截图');
  if (running) throw new Error('AI 正在处理上一项导入，请稍后重试');
  running = true;
  try {
    let output = '';
    const stream = query({
      prompt: createPrompt(input.text?.trim() || '', images),
      options: {
        cwd: process.cwd(),
        model: input.model,
        maxTurns: 1,
        env: {
          CODEBUDDY_API_KEY: input.apiKey,
          CODEBUDDY_INTERNET_ENVIRONMENT: process.env.CODEBUDDY_INTERNET_ENVIRONMENT || 'internal',
        },
      },
    });
    for await (const message of stream) {
      if (message.type !== 'assistant') continue;
      for (const block of message.message.content) if (block.type === 'text') output += block.text;
    }
    return normaliseDraft(extractJson(output));
  } finally {
    running = false;
  }
}
