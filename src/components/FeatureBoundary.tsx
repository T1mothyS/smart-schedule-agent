import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';

function FeatureStatus({ failed = false, onClose, navigation }: { failed?: boolean; onClose?: () => void; navigation?: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onClose) return;
    const trigger = document.activeElement as HTMLElement | null;
    contentRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(contentRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [onClose]);
  return <><div className="feature-status-navigation">{navigation}</div><div className={onClose ? 'feature-status-overlay' : 'feature-status'}>
    <div ref={contentRef} className="feature-status-content" role={onClose ? 'dialog' : failed ? 'alert' : 'status'} aria-modal={onClose ? true : undefined} aria-label={onClose ? '加载弹窗' : undefined}>
      <p>{failed ? '页面加载失败，请刷新后重试。' : '正在加载…'}</p>
      {failed && <button type="button" onClick={() => window.location.reload()}>刷新页面</button>}
      {onClose && <button type="button" onClick={onClose}>取消</button>}
    </div>
  </div></>;
}

class FeatureErrorBoundary extends Component<{ children: ReactNode; onClose?: () => void; navigation?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <FeatureStatus failed onClose={this.props.onClose} navigation={this.props.navigation} /> : this.props.children;
  }
}

export function FeatureBoundary({ children, onClose, navigation }: { children: ReactNode; onClose?: () => void; navigation?: ReactNode }) {
  return <FeatureErrorBoundary onClose={onClose} navigation={navigation}>
    <Suspense fallback={<FeatureStatus onClose={onClose} navigation={navigation} />}>{children}</Suspense>
  </FeatureErrorBoundary>;
}
