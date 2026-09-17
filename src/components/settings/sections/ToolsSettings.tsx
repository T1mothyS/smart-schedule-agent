import { Button } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';

export function ToolsSettings({ onOpenTools }: { onOpenTools?: () => void }) {
  return (
    <SettingSection id="tools" title="挂载工具" description="这里集中放置个人挂载的网页应用，不属于 AI Calendar 主功能。">
      <SettingRow label="Tools 工具中心" description="进入挂载应用菜单，选择要打开的网页工具。">
        <div className="settings-actions">
          <Button tag="button" variant="outline" onClick={onOpenTools} disabled={!onOpenTools}>
            打开 Tools
          </Button>
        </div>
      </SettingRow>
    </SettingSection>
  );
}
