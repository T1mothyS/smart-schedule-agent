import { useState, useEffect, useCallback } from 'react';
import { Model } from '../types';

const STORAGE_KEY = 'defaultModel';

// 获取认证 headers
function getHeaders() {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('aicalendar_token');
  console.log('[useModels] Token from localStorage:', token ? token.slice(0, 20) + '...' : 'null');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function useModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || '';
  });

  const fetchModels = useCallback(async () => {
    const headers = getHeaders();
    console.log('[useModels] Fetching models with headers:', Object.keys(headers).length > 0 ? 'has auth' : 'no auth');
    try {
      const res = await fetch('/api/models', { headers });
      const data = await res.json();
      console.log('[useModels] Response:', data.error || `got ${data.models?.length || 0} models`);
      setModels(data.models || []);
      if (data.models?.length > 0 && !selectedModel) {
        const savedDefault = localStorage.getItem(STORAGE_KEY);
        const modelToUse = savedDefault && data.models.some((m: Model) => m.modelId === savedDefault)
          ? savedDefault
          : (data.defaultModel || data.models[0].modelId);
        setSelectedModel(modelToUse);
        localStorage.setItem(STORAGE_KEY, modelToUse);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  }, [selectedModel]);

  // 初始加载
  useEffect(() => {
    fetchModels();
  }, []);

  return {
    models,
    selectedModel,
    setSelectedModel,
    fetchModels,
  };
}
