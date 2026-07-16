export interface ModelSession<TModel> {
  getAvailableModels(): Promise<TModel[]>;
  close(): void;
}

export interface LoadModelsRequest<TModel> {
  userId: string;
  credentialVersion: string;
  createSession: () => ModelSession<TModel>;
  forceRefresh?: boolean;
}

interface ModelCacheEntry<TModel> {
  credentialVersion: string;
  expiresAt: number;
  models: TModel[];
}

export interface ModelServiceOptions {
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  onCloseError?: (error: unknown) => void;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 1000;

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('获取模型列表超时（' + timeoutMs + 'ms）')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createModelService<TModel>(options: ModelServiceOptions = {}) {
  const ttlMs = positiveNumber(options.ttlMs, DEFAULT_TTL_MS);
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const now = options.now || Date.now;
  const cache = new Map<string, ModelCacheEntry<TModel>>();
  const inFlight = new Map<string, Promise<TModel[]>>();

  async function fetchFresh(request: LoadModelsRequest<TModel>): Promise<TModel[]> {
    const session = request.createSession();
    try {
      return await withTimeout(session.getAvailableModels(), timeoutMs);
    } finally {
      try {
        session.close();
      } catch (error) {
        options.onCloseError?.(error);
      }
    }
  }

  async function load(request: LoadModelsRequest<TModel>): Promise<TModel[]> {
    const cached = cache.get(request.userId);
    if (
      !request.forceRefresh &&
      cached &&
      cached.credentialVersion === request.credentialVersion &&
      cached.expiresAt > now()
    ) {
      return cached.models;
    }

    const requestKey = request.userId + ':' + request.credentialVersion;
    const pending = inFlight.get(requestKey);
    if (pending) return pending;

    const freshRequest = fetchFresh(request);
    inFlight.set(requestKey, freshRequest);

    try {
      const models = await freshRequest;
      cache.set(request.userId, {
        credentialVersion: request.credentialVersion,
        expiresAt: now() + ttlMs,
        models,
      });
      return models;
    } finally {
      if (inFlight.get(requestKey) === freshRequest) inFlight.delete(requestKey);
    }
  }

  function invalidate(userId: string): void {
    cache.delete(userId);
  }

  return { load, invalidate };
}
