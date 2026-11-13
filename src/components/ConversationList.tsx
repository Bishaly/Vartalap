import {
  CloudOff,
  Inbox,
  Paperclip,
  RefreshCw,
  Search,
  SearchX,
  Star
} from 'lucide-react';
import type { AppErrorState, ConversationFilter, ConversationThread } from '../types';

interface ConversationListProps {
  conversations: ConversationThread[];
  selectedThreadId: string | null;
  activeFilter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  hasMorePages: boolean;
  isSyncing: boolean;
  isLoadingMore: boolean;
  isOnline: boolean;
  errorState: AppErrorState | null;
  onReauth: () => void;
  onComposeNew: () => void;
}

const FILTER_OPTIONS: Array<{ id: ConversationFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'important', label: 'Important' },
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' }
];

function formatConversationDate(millis: number): string {
  const date = new Date(millis);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' });
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function ConversationList({
  conversations,
  selectedThreadId,
  activeFilter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onSelectThread,
  onRefresh,
  onLoadMore,
  hasMorePages,
  isSyncing,
  isLoadingMore,
  isOnline,
  errorState,
  onReauth,
  onComposeNew
}: ConversationListProps) {
  return (
    <div className="flex flex-col h-full bg-[var(--v-surface)] border-r border-[var(--v-border)]">
      {/* Header + Search + Filter Chips */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--v-border)] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-[var(--v-text)]">Conversations</h2>
            <span className="text-xs text-[var(--v-muted)] tabular-nums">
              {conversations.length} threads
            </span>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isSyncing}
            aria-label="Synchronize Gmail"
            className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-xl text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[var(--v-secondary)]' : ''}`} />
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-[var(--v-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Find a conversation..."
            aria-label="Find a conversation"
            className="w-full min-h-[40px] pl-10 pr-3 py-2 text-sm rounded-xl bg-[var(--v-bg)] text-[var(--v-text)] placeholder:text-[var(--v-muted)]/75 border border-[var(--v-border)] focus:border-[var(--v-secondary)] focus:outline-none transition-colors"
          />
        </div>

        {/* Interactive Filter Controls */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {FILTER_OPTIONS.map((opt) => {
            const active = activeFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onFilterChange(opt.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[var(--v-primary)] text-white'
                    : 'bg-[var(--v-surface-alt)] text-[var(--v-muted)] hover:text-[var(--v-text)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Offline or Sync Error Banner */}
      {!isOnline && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
          <CloudOff className="w-4 h-4 shrink-0" />
          <span>Offline mode — displaying active session conversations.</span>
        </div>
      )}

      {errorState && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-900 flex items-center justify-between gap-2 text-xs text-red-800 dark:text-red-200">
          <span className="leading-snug">{errorState.message}</span>
          {errorState.kind === 'auth_expired' ? (
            <button
              type="button"
              onClick={onReauth}
              className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-medium whitespace-nowrap shrink-0"
            >
              Reconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={onRefresh}
              className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-medium whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Person-Based Thread List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--v-border)]/70">
        {isSyncing && conversations.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-3 animate-pulse">
                <div className="w-11 h-11 rounded-full bg-[var(--v-surface-alt)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/2 rounded bg-[var(--v-surface-alt)]" />
                  <div className="h-3 w-3/4 rounded bg-[var(--v-bg)]" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 && searchQuery.trim() ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-16">
            <SearchX className="w-10 h-10 text-[var(--v-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--v-text)]">No matching conversations</p>
            <p className="text-xs text-[var(--v-muted)] mt-1 max-w-xs">
              Nothing in your conversations matched &ldquo;{searchQuery}&rdquo;.
            </p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-16">
            <Inbox className="w-10 h-10 text-[var(--v-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--v-text)]">
              No personal conversations in this filter
            </p>
            <p className="text-xs text-[var(--v-muted)] mt-1 max-w-xs">
              Newsletters and automated emails stay separated in Email Folder. Start a message or
              check Email Folder to recategorize a thread.
            </p>
            <button
              type="button"
              onClick={onComposeNew}
              className="mt-4 min-h-[40px] px-4 py-2 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-xs font-semibold transition-opacity"
            >
              New Conversation
            </button>
          </div>
        ) : (
          <>
            {conversations.map((thread) => {
              const isSelected = thread.threadId === selectedThreadId;
              const isUnread = thread.unreadCount > 0;
              return (
                <button
                  key={thread.threadId}
                  type="button"
                  onClick={() => onSelectThread(thread.threadId)}
                  className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors ${
                    isSelected
                      ? 'bg-[var(--v-chip)]/75'
                      : 'hover:bg-[var(--v-surface-alt)]/60'
                  }`}
                >
                  <div
                    className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                      isUnread
                        ? 'bg-[var(--v-primary)] text-white'
                        : 'bg-[var(--v-chip)] text-[var(--v-text)]'
                    }`}
                  >
                    {getInitials(thread.contactName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm truncate ${
                          isUnread ? 'font-bold text-[var(--v-text)]' : 'font-semibold text-[var(--v-text)]'
                        }`}
                      >
                        {thread.contactName}
                      </span>
                      <span
                        className={`text-xs tabular-nums shrink-0 ${
                          isUnread
                            ? 'font-semibold text-[var(--v-secondary)]'
                            : 'text-[var(--v-muted)]'
                        }`}
                      >
                        {formatConversationDate(thread.lastMessageTimestamp)}
                      </span>
                    </div>

                    <p
                      className={`text-xs truncate mt-0.5 ${
                        isUnread
                          ? 'font-semibold text-[var(--v-text)]'
                          : 'font-medium text-[var(--v-muted)]'
                      }`}
                    >
                      {thread.subject}
                    </p>

                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-xs text-[var(--v-muted)] truncate">
                        {thread.lastMessagePreview}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0 text-xs text-[var(--v-muted)] tabular-nums">
                        {thread.isStarred && (
                          <Star className="w-3.5 h-3.5 text-[#D8B982] fill-[#D8B982]" />
                        )}
                        {thread.hasAttachments && <Paperclip className="w-3.5 h-3.5" />}
                        {isUnread && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--v-secondary)] text-white text-[11px] font-semibold inline-flex items-center justify-center">
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {hasMorePages && (
              <div className="p-4 flex justify-center">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="min-h-[40px] px-4 py-2 rounded-xl border border-[var(--v-border)] text-xs font-semibold text-[var(--v-text)] hover:bg-[var(--v-surface-alt)] transition-colors disabled:opacity-50"
                >
                  {isLoadingMore ? 'Loading older threads...' : 'Load older conversations'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
