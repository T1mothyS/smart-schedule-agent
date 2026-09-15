import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Dialog } from 'tdesign-react';
import { APP_CONFIG } from '../../config';
import { SettingsPage } from './SettingsPage';
import './settings.css';

export function SettingsDialog({ onClose, onOpenAdmin, restoreFocusTo }: { onClose: () => void; onOpenAdmin: () => void; restoreFocusTo?: HTMLElement | null }) {
  const triggerRef = useRef(restoreFocusTo ?? document.activeElement as HTMLElement | null);
  const frameRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        const hasOpenSelect = [...document.querySelectorAll<HTMLElement>('.t-select__dropdown')]
          .some(popup => popup.getClientRects().length > 0 && getComputedStyle(popup).visibility !== 'hidden' && !popup.className.includes('leave'));
        if (hasOpenSelect) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // Select 的浮层挂在 body，保留其键盘选择能力。
      const containers = [frameRef.current, ...document.querySelectorAll<HTMLElement>('.t-popup')];
      const controls = containers.flatMap(container => container ? [...container.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')] : [])
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!controls.includes(document.activeElement as HTMLElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trapFocus, true);
    return () => {
      document.removeEventListener('keydown', trapFocus, true);
      if (appRoot) appRoot.inert = wasInert;
      triggerRef.current?.focus();
    };
  }, []);

  return (
    <Dialog visible placement="center" className="settings-dialog" dialogClassName="settings-dialog-content"
      header={false} footer={false} closeBtn={false} closeOnEscKeydown={false} closeOnOverlayClick
      onClose={onClose} onOpened={() => closeRef.current?.focus()} preventScrollThrough>
      <div className="settings-dialog-frame" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" ref={frameRef}>
        <div className="settings-dialog-toolbar">
          <div><h1 id="settings-dialog-title">设置</h1><p>账户、提醒与数据管理</p></div>
          <span className="settings-dialog-version">V{APP_CONFIG.version}</span>
          <button type="button" className="settings-dialog-close" ref={closeRef} onClick={onClose} aria-label="关闭设置">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <SettingsPage onOpenAdmin={onOpenAdmin} />
      </div>
    </Dialog>
  );
}
