import { Mail, MessageCircle, RotateCcw, StickyNote } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AiImportPage } from '../components/AiImportPage';
import { AiNoteBoardHost, useAiNoteBoard } from '../components/AiNoteBoardHost';
import { AiSchedulePanel, type AiSchedulePanelHandle } from '../components/AiSchedulePanel';

export function AiAssistantPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTool = searchParams.get('tool') === 'email-import' ? 'email-import' : 'chat';
  const chatPanelRef = useRef<AiSchedulePanelHandle>(null);
  const [chatState, setChatState] = useState({ hasMessages: false, busy: false });
  const noteBoard = useAiNoteBoard({
    initialNoteId: searchParams.get('note') || undefined,
  });
  const saveNote = useCallback((content: string) => noteBoard.createNote(content), [noteBoard.createNote]);

  const selectTool = (tool: 'chat' | 'email-import') => {
    const next = new URLSearchParams(searchParams);
    if (tool === 'email-import') next.set('tool', tool);
    else next.delete('tool');
    setSearchParams(next);
  };

  const resetDisabled = activeTool !== 'chat' || chatState.busy || !chatState.hasMessages;
  const resetTitle = activeTool !== 'chat'
    ? '邮箱导入模式没有对话历史可重置'
    : chatState.busy
      ? '正在处理，暂时不能重置对话'
      : chatState.hasMessages ? '重置对话' : '当前没有可重置的对话';

  return (
    <div className="ai-assistant-page">
      <div className="ai-assistant-page-main">
        <header className="ai-assistant-topbar">
          <div className="ai-assistant-topbar-title">
            <span className="eyebrow">AI WORKSPACE</span>
            <strong>AI 对话</strong>
          </div>
          <nav className="ai-assistant-tabs" role="tablist" aria-label="AI 工作区">
            <button
              type="button"
              role="tab"
              id="ai-tab-chat"
              aria-controls="ai-panel-content"
              aria-selected={activeTool === 'chat'}
              className={`ai-assistant-tab${activeTool === 'chat' ? ' active' : ''}`}
              onClick={() => selectTool('chat')}
            >
              <MessageCircle size={16} aria-hidden="true" />
              <span>AI 对话</span>
            </button>
            <button
              type="button"
              role="tab"
              id="ai-tab-email-import"
              aria-controls="ai-panel-content"
              aria-selected={activeTool === 'email-import'}
              className={`ai-assistant-tab${activeTool === 'email-import' ? ' active' : ''}`}
              onClick={() => selectTool('email-import')}
            >
              <Mail size={16} aria-hidden="true" />
              <span>邮箱导入</span>
            </button>
          </nav>
          <div className="ai-assistant-topbar-actions">
            <button
              type="button"
              className="ai-workspace-action"
              onClick={() => { void chatPanelRef.current?.resetHistory(); }}
              disabled={resetDisabled}
              title={resetTitle}
              aria-label={resetTitle}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>重置</span>
            </button>
            <button
              type="button"
              className="ai-workspace-action ai-workspace-note-action"
              onClick={noteBoard.toggleDrawer}
              aria-expanded={noteBoard.drawerOpen}
              aria-controls="ai-note-board"
              title="打开 AI 记事板"
              aria-label="打开 AI 记事板"
            >
              <StickyNote size={16} aria-hidden="true" />
              <span>记事板</span>
              {noteBoard.pendingCount > 0 && <em aria-label={`${noteBoard.pendingCount} 条未完成记事`}>{noteBoard.pendingCount}</em>}
            </button>
          </div>
        </header>
        <section
          id="ai-panel-content"
          className="ai-assistant-tool-content"
          role="tabpanel"
          aria-labelledby={activeTool === 'chat' ? 'ai-tab-chat' : 'ai-tab-email-import'}
        >
          {activeTool === 'email-import' ? (
            <AiImportPage />
          ) : (
            <div className="ai-schedule-page">
              <section className="ai-schedule-page-card">
                <AiSchedulePanel
                  ref={chatPanelRef}
                  onSaveNote={saveNote}
                  onChatStateChange={setChatState}
                />
              </section>
            </div>
          )}
        </section>
      </div>
      <AiNoteBoardHost controller={noteBoard} aiBusy={chatState.busy} />
    </div>
  );
}
