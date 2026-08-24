export interface WeatherLocation {
  id: number;
  name: string;
  admin1: string | null;
  admin2: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  displayName: string;
}

export interface DailyWeather {
  date: string;
  timezone: string;
  weatherCode: number;
  description: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitationProbabilityMax: number | null;
  windSpeedMax: number | null;
}

type FetchLike = typeof fetch;

const locationCache = new Map<string, { expiresAt: number; value: WeatherLocation[] }>();
const weatherCache = new Map<string, { expiresAt: number; value: DailyWeather }>();
const LOCATION_CACHE_MS = 12 * 60 * 60 * 1000;
const WEATHER_CACHE_MS = 15 * 60 * 1000;
const MAX_LOCATION_CACHE_ENTRIES = 500;
const MAX_WEATHER_CACHE_ENTRIES = 1_000;

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as K | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function isWeatherQuestion(text: string): boolean {
  return /(天气|气温|温度|会下雨|下不下雨|降雨|刮风)/.test(text.replace(/\s+/g, ''));
}

export function extractWeatherLocationQuery(text: string): string | null {
  const normalized = text.replace(/[？?！!。]/g, ' ').trim();
  const weatherIndex = normalized.indexOf('天气');
  const before = weatherIndex >= 0 ? normalized.slice(0, weatherIndex) : normalized;
  const after = weatherIndex >= 0 ? normalized.slice(weatherIndex + 2) : '';
  const clean = (value: string) => value
    .replace(/(请问|麻烦|帮我|帮忙|查一下|查询|看看|我想知道|今天|明天|后天|现在|当地|的|怎么样|如何|预报)/g, '')
    .replace(/\s+/g, '')
    .trim();
  const first = clean(before);
  if (first.length >= 2 && first.length <= 40) return first;
  const second = clean(after);
  return second.length >= 2 && second.length <= 40 ? second : null;
}

function weatherDescription(code: number): string {
  if (code === 0) return '晴';
  if ([1, 2].includes(code)) return '晴间多云';
  if (code === 3) return '阴';
  if ([45, 48].includes(code)) return '有雾';
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '有雨';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '有雪';
  if ([95, 96, 99].includes(code)) return '雷雨';
  return '天气状况未知';
}

async function fetchJson(url: URL, fetcher: FetchLike, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AI-Calendar/1.0' },
    });
    if (!response.ok) throw new Error(`天气服务返回 HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('天气服务响应超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cleanPart(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

export async function searchLocations(
  query: string,
  options: { fetcher?: FetchLike; timeoutMs?: number; now?: number } = {},
): Promise<WeatherLocation[]> {
  const normalized = query.trim();
  if (normalized.length < 2 || normalized.length > 80) return [];
  const cacheKey = normalized.toLocaleLowerCase('zh-CN');
  const now = options.now ?? Date.now();
  const cached = locationCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', normalized);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');
  const payload = await fetchJson(url, options.fetcher || fetch, options.timeoutMs ?? 6_000);
  const result: WeatherLocation[] = (Array.isArray(payload?.results) ? payload.results : [])
    .map((item: any) => {
      const name = cleanPart(item.name);
      const latitude = Number(item.latitude);
      const longitude = Number(item.longitude);
      const timezone = cleanPart(item.timezone);
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !timezone) return null;
      const admin1 = cleanPart(item.admin1);
      const admin2 = cleanPart(item.admin2);
      const country = cleanPart(item.country);
      const parts = [name, admin2, admin1, country].filter((part, index, all) => part && all.indexOf(part) === index);
      return {
        id: Number(item.id),
        name,
        admin1,
        admin2,
        country,
        countryCode: cleanPart(item.country_code),
        latitude,
        longitude,
        timezone,
        displayName: parts.join(' · '),
      } satisfies WeatherLocation;
    })
    .filter((item: WeatherLocation | null): item is WeatherLocation => item !== null);
  setBoundedCache(locationCache, cacheKey, { expiresAt: now + LOCATION_CACHE_MS, value: result }, MAX_LOCATION_CACHE_ENTRIES);
  return result;
}

export async function getDailyWeather(
  location: Pick<WeatherLocation, 'latitude' | 'longitude' | 'timezone'>,
  date: string,
  options: { fetcher?: FetchLike; timeoutMs?: number; now?: number } = {},
): Promise<DailyWeather> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('天气日期格式不正确');
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error('天气地点坐标不正确');
  const cacheKey = `${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}:${location.timezone}:${date}`;
  const now = options.now ?? Date.now();
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('timezone', location.timezone);
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max');
  const payload = await fetchJson(url, options.fetcher || fetch, options.timeoutMs ?? 6_000);
  const weatherCode = Number(payload?.daily?.weather_code?.[0]);
  if (!Number.isFinite(weatherCode) || payload?.daily?.time?.[0] !== date) throw new Error('天气服务未返回指定日期的数据');
  const numberOrNull = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
  const result: DailyWeather = {
    date,
    timezone: cleanPart(payload.timezone) || location.timezone,
    weatherCode,
    description: weatherDescription(weatherCode),
    temperatureMax: numberOrNull(payload.daily.temperature_2m_max?.[0]),
    temperatureMin: numberOrNull(payload.daily.temperature_2m_min?.[0]),
    precipitationProbabilityMax: numberOrNull(payload.daily.precipitation_probability_max?.[0]),
    windSpeedMax: numberOrNull(payload.daily.wind_speed_10m_max?.[0]),
  };
  setBoundedCache(weatherCache, cacheKey, { expiresAt: now + WEATHER_CACHE_MS, value: result }, MAX_WEATHER_CACHE_ENTRIES);
  return result;
}

export function clearWeatherCaches(): void {
  locationCache.clear();
  weatherCache.clear();
}
