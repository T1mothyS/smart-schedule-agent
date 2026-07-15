import { useCallback } from 'react';
import { Select, Tooltip } from 'tdesign-react';
import { ChevronDownIcon, LockOnIcon, LockOffIcon, EditIcon, TaskIcon } from 'tdesign-icons-react';
import { Model, PermissionMode } from '../types';

interface ChatInputProps {
  inputValue: string;
  selectedModel: string;
  models: Model[];
  isLoading: boolean;
  permissionMode: PermissionMode;
  onSend: (message: string) => void;
  onStop: () => void;
  onChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

// 权限模式配置
const PERMISSION_MODE_CONFIG: Record<PermissionMode, { 
  label: string; 
  shortLabel: string;
  icon: React.ReactNode; 
  color: string;
  description: string;
}> = {
  'default': { 
    label: '默认模式', 
    shortLabel: '默认',
    icon: <LockOnIcon />, 
    color: '#0052d9',
    description: '每次操作都需要确认'
  },
  'acceptEdits': { 
    label: '自动编辑', 
    shortLabel: '自动编辑',
    icon: <EditIcon />, 
    color: '#2ba471',
    description: '自动允许文件编辑操作'
  },
  'plan': { 
    label: '仅规划', 
    shortLabel: '仅规划',
    icon: <TaskIcon />, 
    color: '#ed7b2f',
    description: '只生成计划，不执行操作'
  },
  'bypassPermissions': { 
    label: '全部允许', 
    shortLabel: '全部允许',
    icon: <LockOffIcon />, 
    color: '#e34d59',
    description: '跳过所有权限确认（危险）'
  },
};

export function ChatInput({
  inputValue,
  selectedModel,
  models,
  isLoading,
  permissionMode,
  onSend,
  onStop,
  onChange,
  onModelChange,
  onPermissionModeChange,
}: ChatInputProps) {
  const handleSend = useCallback(() => {
    if (inputValue.trim() && selectedModel) {
      onSend(inputValue.trim());
    }
  }, [inputValue, selectedModel, onSend]);

  const currentModeConfig = PERMISSION_MODE_CONFIG[permissionMode];

  return (
    <div 
      className="px-4 pb-6 pt-4"
      style={{ 
        backgroundColor: 'var(--td-bg-color-page)'
      }}
    >
      <div className="max-w-3xl mx-auto">
        <form className="safe-chat-sender" onSubmit={event => { event.preventDefault(); handleSend(); }}>
          <textarea
            value={inputValue}
            placeholder="输入消息..."
            disabled={!selectedModel}
            rows={3}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="safe-chat-sender-footer">
            <div className="flex items-center gap-2">
            {/* 模型选择器 */}
            <Select
              value={selectedModel}
              onChange={(value) => onModelChange(value as string)}
              placeholder="选择模型"
              size="small"
              style={{ width: 160 }}
              filterable
              borderless
              suffixIcon={<ChevronDownIcon />}
            >
              {models.map(model => (
                <Select.Option key={model.modelId} value={model.modelId} label={model.name} />
              ))}
            </Select>
            
            {/* 分隔线 */}
            <div 
              className="h-4 w-px"
              style={{ backgroundColor: 'var(--td-component-stroke)' }}
            />
            
            {/* 权限模式选择器 */}
            <Tooltip content={currentModeConfig.description} placement="top">
              <Select
                value={permissionMode}
                onChange={(value) => onPermissionModeChange(value as PermissionMode)}
                size="small"
                style={{ width: 110 }}
                borderless
                suffixIcon={<ChevronDownIcon />}
                prefixIcon={
                  <span style={{ color: currentModeConfig.color }}>
                    {currentModeConfig.icon}
                  </span>
                }
                popupProps={{
                  overlayInnerStyle: { width: 140 }
                }}
              >
                {(Object.keys(PERMISSION_MODE_CONFIG) as PermissionMode[]).map(mode => {
                  const config = PERMISSION_MODE_CONFIG[mode];
                  return (
                    <Select.Option 
                      key={mode} 
                      value={mode} 
                      label={config.shortLabel}
                    >
                      <div className="flex items-center gap-2">
                        <span style={{ color: config.color }}>{config.icon}</span>
                        <span>{config.shortLabel}</span>
                      </div>
                    </Select.Option>
                  );
                })}
              </Select>
            </Tooltip>
            </div>
            <button type={isLoading ? 'button' : 'submit'} onClick={isLoading ? onStop : undefined} disabled={!isLoading && (!selectedModel || !inputValue.trim())}>
              {isLoading ? '停止' : '发送'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
