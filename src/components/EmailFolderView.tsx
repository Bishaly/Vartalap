import {
  Archive,
  FileEdit,
  FolderOpen,
  Inbox,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2
} from 'lucide-react';
import type { ConversationThread, EmailFolder } from '../types';

interface EmailFolderViewProps {
  activeFolder: EmailFolder;
  onSelectFolder: (folder: EmailFolder) => void;
  threads: ConversationThread[];
  selectedThreadId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectThread: (threadId: string) => void;
  onRefreshFolder: () => void;
  onLoadMoreFolder: () => void;
  hasMorePages: boolean;
  isLoading: boolean;
}

const FOLDER_TABS: Array<{ id: EmailFolder; label: string; icon: typeof Inbox }> = [
  { id: 'INBOX', label: 'Inbox', icon: Inbox },
  { id: 'SENT', label: 'Sent', icon: Send },
  { id: 'DRAFT', label: 'Drafts', icon: FileEdit },
  { id: 'STARRED', label: 'Starred', icon: Star },
  { id: 'SPAM', label: 'Spam', icon: ShieldAlert },
  { id: 'TRASH', label: 'Trash', icon: Trash2 },
  { id: 'ARCHIVE', label: 'Archive', icon: Archive }
];

function formatFolderTimestamp(millis: number): string {
  const date = new Date(millis);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function EmailFolderView({
  activeFolder,
  onSelectFolder,
  threads,
  selectedThreadId,
  searchQuery,
  onSearchChange,
  onSelectThread,
  onRefreshFolder,
  onLoadMoreFolder,
  hasMorePages,
  isLoading
}: EmailFolderViewProps) {
  const activeTabMeta = FOLDER_TABS.find((t) => t.id === activeFolder) ?? FOLDER_TABS[0];

  return (
    <div className="flex flex-col h-full bg-[var(--v-surface)] border-r border-[var(--v-border)]">
      <div className="px-4 pt-4 pb-3 border-b border-[var(--v-border)] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-[var(--v-text)]">Email Folder</h2>
            <span className="text-xs text-[var(--v-muted)] tabular-nums">
              {activeTabMeta.label} · {threads.length} loaded
            </span>
          </div>

          <button
            type="button"
            onClick={onRefreshFolder}
            disabled={isLoading}
            aria-label={`Refresh ${activeTabMeta.label}`}
            className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-xl text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[var(--v-secondary)]' : ''}`} />
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-[var(--v-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={`Search in ${activeTabMeta.label}...`}
            className="w-full min-h-[40px] pl-10 pr-3 py-2 text-sm rounded-xl bg-[var(--v-bg)] text-[var(--v-text)] placeholder:text-[var(--v-muted)]/75 border border-[var(--v-border)] focus:border-[var(--v-secondary)] focus:outline-none transition-colors"
          />
        </div>

        {/* Folder Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {FOLDER_TABS.map((folder) => {
            const Icon = folder.icon;
            const active = activeFolder === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[var(--v-primary)] text-white'
                    : 'bg-[var(--v-surface-alt)] text-[var(--v-muted)] hover:text-[var(--v-text)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{folder.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Traditional Email List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--v-border)]/70">
        {isLoading && threads.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="space-y-2 animate-pulse py-2">
                <div className="h-3 w-1/3 rounded bg-[var(--v-surface-alt)]" />
                <div className="h-3.5 w-2/3 rounded bg-[var(--v-surface-alt)]" />
                <div className="h-3 w-full rounded bg-[var(--v-bg)]" />
              </div>
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-16">
            <FolderOpen className="w-10 h-10 text-[var(--v-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--v-text)]">
              No emails in {activeTabMeta.label}
            </p>
            <p className="text-xs text-[var(--v-muted)] mt-1 max-w-xs">
              Folders query Gmail lazily by label so your entire mailbox is never bulk-downloaded.
            </p>
          </div>
        ) : (
          <>
            {threads.map((thread) => {
              const selected = thread.threadId === selectedThreadId;
              const unread = thread.unreadCount > 0;
              return (
                <button
                  key={thread.threadId}
                  type="button"
                  onClick={() => onSelectThread(thread.threadId)}
                  className={`w-full text-left px-4 py-3.5 space-y-1 transition-colors ${
                    selected
                      ? 'bg-[var(--v-chip)]/75'
                      : 'hover:bg-[var(--v-surface-alt)]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`truncate ${
                        unread ? 'font-bold text-[var(--v-text)]' : 'font-medium text-[var(--v-muted)]'
                      }`}
                    >
                      {thread.contactName} · {thread.contactEmail}
                    </span>
                    <span className="tabular-nums text-[var(--v-muted)] shrink-0">
                      {formatFolderTimestamp(thread.lastMessageTimestamp)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-sm truncate ${
                        unread ? 'font-bold text-[var(--v-text)]' : 'font-semibold text-[var(--v-text)]'
                      }`}
                    >
                      {thread.subject}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0 text-[var(--v-muted)]">
                      {thread.isStarred && (
                        <Star className="w-3.5 h-3.5 text-[#D8B982] fill-[#D8B982]" />
                      )}
                      {thread.hasAttachments && <Paperclip className="w-3.5 h-3.5" />}
                    </div>
                  </div>

                  <p className="text-xs text-[var(--v-muted)] truncate">
                    {thread.lastMessagePreview}
                  </p>
                </button>
              );
            })}

            {hasMorePages && (
              <div className="p-4 flex justify-center">
                <button
                  type="button"
                  onClick={onLoadMoreFolder}
                  disabled={isLoading}
                  className="min-h-[40px] px-4 py-2 rounded-xl border border-[var(--v-border)] text-xs font-semibold text-[var(--v-text)] hover:bg-[var(--v-surface-alt)] transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Loading...' : `Load more in ${activeTabMeta.label}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
