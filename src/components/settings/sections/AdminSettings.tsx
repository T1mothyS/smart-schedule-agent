import { Button } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';

export function AdminSettings({ onOpenAdmin }: { onOpenAdmin?: () => void }) {
  return (
    <SettingSection id="admin" title="管理员功能">
      <SettingRow label="管理面板" description="管理用户、查看调试日志与全站备份。">
        <div className="settings-actions"><Button tag="button" variant="outline" onClick={onOpenAdmin}>打开管理面板</Button></div>
      </SettingRow>
    </SettingSection>
  );
}
