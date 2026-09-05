import { useState, useEffect, useCallback } from 'react';
import { Button, MessagePlugin, Select } from 'tdesign-react';
import { SettingRow } from '../SettingRow';
import type { SettingsAuthHeaders } from '../types';

const fallbackModels = [
  { modelId: 'glm-5.1', name: 'GLM 5.1（推荐）' },
  { modelId: 'glm-4', name: 'GLM 4' },
  { modelId: 'deepseek-v3', name: 'DeepSeek V3' },
  { modelId: 'kimi-k2', name: 'Kimi K2' },
  { modelId: 'qwen2.5', name: 'Qwen 2.5' },
];

export function ModelSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [models, setModels] = useState(fallbackModels);
  const [selectedModel, setSelectedModel] = useState('glm-5.1');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadSelection = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/schedule-model', { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '模型设置加载失败');
      setSelectedModel(data.model || 'glm-5.1');
      setLoaded(true);
    } catch (error: any) { setLoadError(error?.message || '模型设置加载失败'); }
  }, [authHeaders]);

  const loadModels = useCallback(async (refresh = false) => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`, { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '模型列表读取失败');
      if (data.models?.length) setModels(data.models);
      if (refresh) MessagePlugin.success('模型列表已刷新');
    } catch (error: any) {
      if (refresh) MessagePlugin.error(error?.message || '模型列表读取失败');
    } finally { setRefreshing(false); }
  }, [authHeaders]);

  useEffect(() => { void loadSelection(); void loadModels(); }, [loadSelection, loadModels]);
  const options = models.some(model => model.modelId === selectedModel)
    ? models : [...models, { modelId: selectedModel, name: selectedModel }];

  const saveModel = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/schedule-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ model: selectedModel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '模型保存失败');
      MessagePlugin.success('AI 模型已保存');
    } catch (error: any) { MessagePlugin.error(error?.message || '模型保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <SettingRow label="日程 AI 模型" description="影响日程解析和普通对话；模型列表不可用时保留常用选项。">
      {loadError && <div className="settings-status" role="alert">{loadError}<Button tag="button" variant="outline" onClick={loadSelection}>重试模型设置</Button></div>}
      <Select aria-label="日程 AI 模型" popupProps={{ overlayClassName: 'settings-select-popup' }} value={selectedModel} disabled={!loaded || saving || !!loadError} onChange={value => setSelectedModel(String(value))} options={options.map(model => ({ value: model.modelId, label: model.name || model.modelId }))} />
      <div className="settings-actions">
        <Button tag="button" onClick={saveModel} loading={saving} disabled={!loaded || saving || !!loadError}>保存模型</Button>
        <Button tag="button" variant="outline" loading={refreshing} disabled={refreshing || saving} onClick={() => void loadModels(true)}>刷新模型列表</Button>
      </div>
    </SettingRow>
  );
}
