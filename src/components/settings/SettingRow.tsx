import type { ReactNode } from 'react';
import { Input, type InputProps } from 'tdesign-react';

// 当前 TDesign Input 不透传原生 id，使用其公开 inputElement 关联表单标签。
export function SettingInput({ id, ...props }: InputProps & { id: string }) {
  return <Input {...props} ref={instance => { if (instance?.inputElement) instance.inputElement.id = id; }} />;
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export function SettingRow({ label, description, htmlFor, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-row-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <h3>{label}</h3>}
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
