import { useRef, type ReactNode } from 'react';

export function SettingsLayout({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const sections = [
    ['account', '账户'], ['ai', 'AI'], ['guides', '接入指南'], ['notifications', '通知'],
    ['daily-report', '日报'], ['library', '知识库'], ['mail', '邮箱'], ['data', '数据'],
    ...(isAdmin ? [['admin', '管理']] : []),
  ];

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {sections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => {
            const section = contentRef.current?.querySelector<HTMLElement>(`#settings-${id}`);
            section?.scrollIntoView({ block: 'start' });
            section?.focus({ preventScroll: true });
          }}>{label}</button>
        ))}
      </nav>
      <div className="settings-scroll" ref={contentRef}>{children}</div>
    </div>
  );
}
