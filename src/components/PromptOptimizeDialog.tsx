import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from 'tdesign-react';
import { useAuth } from '../hooks/useAuth';
import type { NoteItem } from './NoteBoard';

export function PromptOptimizeDialog({ note, onClose, onReplace }: {
  note: NoteItem; onClose: () => void; onReplace: (note: NoteItem, text: string) => Promise<void>;
}) {
  const { authHeaders } = useAuth();
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController>();
  const mounted = useRef(true);
  const opener = useRef(document.activeElement as HTMLElement | null);
  async function optimize() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setCopied(false);
    const timer = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch('/api/ai/prompt-optimize', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note.content }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || typeof data.optimizedText !== 'string' || !data.optimizedText.trim()) throw new Error(data.error || '优化失败，请重试');
      if (mounted.current && request.current === controller && !controller.signal.aborted) setResult(data.optimizedText);
    } catch (e) {
      if (mounted.current && request.current === controller) setError(controller.signal.aborted ? '优化超时，请重试' : e instanceof Error ? e.message : '优化失败，请重试');
    } finally {
      clearTimeout(timer);
      if (mounted.current && request.current === controller) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true; dialog.current?.focus(); void optimize();
    return () => { mounted.current = false; request.current?.abort(); opener.current?.focus(); };
  // The dialog is mounted once per immutable note snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function replace() {
    setSaving(true); setError('');
    try { await onReplace(note, result); onClose(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '替换失败，请重试'); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(result); setCopied(true); }
    catch { setError('复制失败，请手动选中优化结果复制'); }
  }
  return <Dialog visible header="✨ 优化提示词" width="min(640px, calc(100vw - 24px))"
    closeOnEscKeydown={!saving} closeOnOverlayClick={false} closeBtn={!saving}
    onClose={() => { if (!saving) onClose(); }} footer={false}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="优化提示词预览" tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} style={{ maxHeight: '65dvh', overflowY: 'auto', overflowWrap: 'anywhere' }}>
      <p>原文</p><div style={{ whiteSpace: 'pre-wrap' }}>{note.content}</div>
      <p>优化结果</p>
      <div aria-live="polite" style={{ whiteSpace: 'pre-wrap', minHeight: 60 }}>{result || (busy ? '正在优化…' : '尚无优化结果')}</div>
      {busy && result && <p role="status">正在重新优化…</p>}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
        <Button disabled={!result || busy} loading={saving} onClick={() => void replace()}>替换原文</Button>
        <Button variant="outline" disabled={!result || saving} onClick={() => void copy()}>{copied ? '已复制' : '复制'}</Button>
        <Button variant="outline" disabled={busy || saving} onClick={() => void optimize()}>重新优化</Button>
        <Button variant="text" disabled={saving} onClick={onClose}>取消</Button>
      </div>
    </div>
  </Dialog>;
}
