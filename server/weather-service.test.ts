import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWeatherCaches,
  extractWeatherLocationQuery,
  getDailyWeather,
  isWeatherQuestion,
  searchLocations,
} from './weather-service.js';

test('天气意图优先使用问题中的明确地点', () => {
  assert.equal(isWeatherQuestion('北京明天天气怎么样？'), true);
  assert.equal(extractWeatherLocationQuery('北京明天天气怎么样？'), '北京');
  assert.equal(extractWeatherLocationQuery('今天天气怎么样？'), null);
  assert.equal(isWeatherQuestion('帮我安排明天下午的会议'), false);
});
test('地点搜索标准化结果并在缓存期内复用', async () => {
  clearWeatherCaches();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      results: [{
        id: 1,
        name: '朝阳区',
        admin1: '北京市',
        country: '中国',
        country_code: 'CN',
        latitude: 39.92,
        longitude: 116.44,
        timezone: 'Asia/Shanghai',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const first = await searchLocations('朝阳区', { fetcher, now: 1_000 });
  const second = await searchLocations('朝阳区', { fetcher, now: 2_000 });
  assert.equal(calls, 1);
  assert.equal(first[0].displayName, '朝阳区 · 北京市 · 中国');
  assert.deepEqual(second, first);
});

test('天气预报只接受指定日期并返回可读字段', async () => {
  clearWeatherCaches();
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    timezone: 'Asia/Shanghai',
    daily: {
      time: ['2026-08-24'],
      weather_code: [61],
      temperature_2m_max: [29.4],
      temperature_2m_min: [22.1],
      precipitation_probability_max: [70],
      wind_speed_10m_max: [18.2],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await getDailyWeather(
    { latitude: 39.92, longitude: 116.44, timezone: 'Asia/Shanghai' },
    '2026-08-24',
    { fetcher },
  );
  assert.equal(result.description, '有雨');
  assert.equal(result.temperatureMax, 29.4);
  assert.equal(result.precipitationProbabilityMax, 70);
});

test('天气服务超时时明确失败而不是返回虚构结果', async () => {
  clearWeatherCaches();
  const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    () => searchLocations('超时地点', { fetcher, timeoutMs: 5 }),
    /天气服务响应超时/,
  );
});
