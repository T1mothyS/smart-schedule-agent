export const NO_IMAGE_REASONS = ['no_reliable_source', 'search_unavailable', 'not_reported'] as const;
export type NoImageReason = typeof NO_IMAGE_REASONS[number];
export interface DailyReportMediaReceipt {
  candidateImageCount: number;
  imageCount: number;
  mediaFailureCount: number;
  failureCodes: string[];
  noImageReason: NoImageReason | null;
  previousImageCount: number;
  consecutiveNoImageReports: number;
  warnings: string[];
}

/** Only bounded counters/codes are durable. Never persist remote URLs or free-form caller text. */
export function parseMediaReceipt(value: unknown): DailyReportMediaReceipt | null {
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (!data || typeof data !== 'object') return null;
    for (const key of ['candidateImageCount', 'imageCount', 'mediaFailureCount', 'previousImageCount', 'consecutiveNoImageReports']) {
      if (!Number.isInteger(data[key]) || data[key] < 0 || data[key] > 10000) return null;
    }
    if (!Array.isArray(data.failureCodes) || data.failureCodes.length > 100 || data.failureCodes.some((code: unknown) => typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code))) return null;
    if (data.noImageReason !== null && !NO_IMAGE_REASONS.includes(data.noImageReason)) return null;
    if (!Array.isArray(data.warnings) || data.warnings.length > 4 || data.warnings.some((code: unknown) => typeof code !== 'string' || !['NO_IMAGES', 'NO_IMAGE_REASON_MISSING', 'REPEATED_NO_IMAGES', 'REPLACES_ILLUSTRATED_REPORT'].includes(code))) return null;
    return { candidateImageCount: data.candidateImageCount, imageCount: data.imageCount, mediaFailureCount: data.mediaFailureCount, failureCodes: [...new Set<string>(data.failureCodes)], noImageReason: data.noImageReason, previousImageCount: data.previousImageCount, consecutiveNoImageReports: data.consecutiveNoImageReports, warnings: [...new Set<string>(data.warnings)] };
  } catch { return null; }
}

export function buildMediaReceipt(input: { candidateImageCount: number; imageCount: number; failureCodes: string[]; noImageReason?: unknown; previousImageCount: number; precedingNoImageReports: number }): DailyReportMediaReceipt {
  if (input.noImageReason !== undefined && !NO_IMAGE_REASONS.includes(input.noImageReason as NoImageReason)) throw new Error('noImageReason 不受支持');
  const noImageReason = input.imageCount ? null : (input.noImageReason as NoImageReason || 'not_reported');
  const warnings: string[] = [];
  const consecutiveNoImageReports = input.imageCount ? 0 : input.precedingNoImageReports + 1;
  if (!input.imageCount) warnings.push('NO_IMAGES');
  if (!input.imageCount && !input.candidateImageCount && noImageReason === 'not_reported') warnings.push('NO_IMAGE_REASON_MISSING');
  if (consecutiveNoImageReports >= 2) warnings.push('REPEATED_NO_IMAGES');
  if (!input.imageCount && input.previousImageCount > 0) warnings.push('REPLACES_ILLUSTRATED_REPORT');
  const receipt = parseMediaReceipt({ candidateImageCount: input.candidateImageCount, imageCount: input.imageCount, mediaFailureCount: input.failureCodes.length, failureCodes: input.failureCodes, noImageReason, previousImageCount: input.previousImageCount, consecutiveNoImageReports, warnings });
  if (!receipt) throw new Error('媒体统计不正确');
  return receipt;
}
