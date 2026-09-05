import type { ReactNode } from 'react';

interface SettingSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingSection({ id, title, description, children }: SettingSectionProps) {
  return (
    <section id={`settings-${id}`} className="setting-section" aria-labelledby={`settings-${id}-title`} tabIndex={-1}>
      <header className="setting-section-header">
        <h2 id={`settings-${id}-title`}>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="setting-section-body">{children}</div>
    </section>
  );
}
