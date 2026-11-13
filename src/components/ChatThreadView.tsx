import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudUpload,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  MessageSquare,
  Paperclip,
  Send,
  Star,
  X
} from 'lucide-react';
import type {
  ChatMessage,
  ConversationCategory,
  ConversationThread,
  EmailAttachment,
  OutgoingAttachmentFile
} from '../types';

interface ChatThreadViewProps {
  thread: ConversationThread | null;
  driveEnabled: boolean;
  onBack: () => void;
  onToggleStar: (thread: ConversationThread) => void;
  onToggleArchive: (thread: ConversationThread) => void;
  onSetCategory: (threadId: string, category: ConversationCategory) => void;
  onSendReply: (params: {
    thread: ConversationThread;
    replyAll: boolean;
    bodyText: string;
    attachments: OutgoingAttachmentFile[];
    onSuccess: () => void;
  }) => void;
  onDownloadAttachment: (attachment: EmailAttachment) => Promise<string | null>;
  onSaveAttachmentToDrive: (attachment: EmailAttachment) => void;
  isSending: boolean;
  sendError: string | null;
  onClearSendError: () => void;
}

const CATEGORY_CHOICES: Array<{ id: ConversationCategory; label: string }> = [
  { id: 'personal', label: 'Personal' },
  { id: 'work', label: 'Work' },
  { id: 'important', label: 'Important' },
  { id: 'automated', label: 'Automated / Bulk' }
];

function formatMessageTime(millis: number): string {
  return new Date(millis).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function ChatThreadView({
  thread,
  driveEnabled,
  onBack,
  onToggleStar,
  onToggleArchive,
  onSetCategory,
  onSendReply,
  onDownloadAttachment,
  onSaveAttachmentToDrive,
  isSending,
  sendError,
  onClearSendError
}: ChatThreadViewProps) {
  const [replyAll, setReplyAll] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<OutgoingAttachmentFile[]>([]);
  const [expandedQuotedIds, setExpandedQuotedIds] = useState<Record<string, boolean>>({});
  const [htmlModeIds, setHtmlModeIds] = useState<Record<string, boolean>>({});
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    setDetailsOpen(false);
  }, [thread?.threadId, thread?.messages.length]);

  if (!thread) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8 bg-[var(--v-bg)]">
        <div className="w-14 h-14 rounded-2xl bg-[var(--v-chip)] text-[var(--v-primary)] flex items-center justify-center mb-4">
          <MessageSquare className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--v-text)]">
          Select a Gmail conversation
        </h3>
        <p className="text-sm text-[var(--v-muted)] mt-1.5 max-w-sm">
          Choose any thread from Conversations or Email Folder to read and reply directly through
          your Gmail account.
        </p>
      </div>
    );
  }

  const latestMessage = thread.messages[thread.messages.length - 1];

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const converted = await Promise.all(
      files.map(async (file) => ({
        id: `${file.name}_${file.size}_${Date.now()}`,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        base64Content: await readFileAsBase64(file)
      }))
    );
    setPendingAttachments((prev) => [...prev, ...converted]);
    event.target.value = '';
  };

  const handleAttachmentDownload = async (att: EmailAttachment) => {
    setDownloadingId(att.id);
    try {
      const dataUrl = attachmentPreviews[att.id] ?? (await onDownloadAttachment(att));
      if (!dataUrl) return;
      if (att.mimeType.startsWith('image/')) {
        setAttachmentPreviews((prev) => ({ ...prev, [att.id]: dataUrl }));
      }
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = att.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setDownloadingId(null);
    }
  };

  const handleTriggerSend = () => {
    if (!composerText.trim() || isSending) return;
    onSendReply({
      thread,
      replyAll,
      bodyText: composerText.trim(),
      attachments: pendingAttachments,
      onSuccess: () => {
        setComposerText('');
        setPendingAttachments([]);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--v-bg)] relative">
      {/* Top Thread Header */}
      <header className="px-4 sm:px-6 py-3 bg-[var(--v-surface)] border-b border-[var(--v-border)] flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to list"
            className="lg:hidden min-h-[40px] min-w-[40px] -ml-2 flex items-center justify-center rounded-xl text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--v-text)] truncate">
              {thread.contactName}
            </h2>
            <p className="text-xs text-[var(--v-muted)] truncate">
              {thread.subject} · {thread.participantsSummary} ·{' '}
              <span className="tabular-nums">{thread.messageCount} messages</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-label="Conversation Details"
            title="Conversation Details"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)] transition-colors"
          >
            <Info className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleStar(thread)}
            aria-label={thread.isStarred ? 'Remove star' : 'Star conversation'}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)] transition-colors"
          >
            <Star
              className={`w-4 h-4 ${
                thread.isStarred ? 'text-[#D8B982] fill-[#D8B982]' : ''
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => onToggleArchive(thread)}
            aria-label={thread.isArchived ? 'Move to inbox' : 'Archive conversation'}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)] transition-colors"
          >
            {thread.isArchived ? (
              <ArchiveRestore className="w-4 h-4 text-[var(--v-secondary)]" />
            ) : (
              <Archive className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Send Failure Banner */}
      {sendError && (
        <div
          role="alert"
          className="px-4 sm:px-6 py-2.5 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900 flex items-center justify-between gap-3 text-xs text-red-800 dark:text-red-200"
        >
          <span>{sendError}</span>
          <button
            type="button"
            onClick={onClearSendError}
            className="font-semibold underline whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Message Bubbles Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
        {thread.messages.map((msg: ChatMessage) => {
          const isOutgoing = msg.direction === 'outgoing';
          const showHtml = Boolean(htmlModeIds[msg.messageId] && msg.bodyHtmlSanitized);
          const showQuoted = Boolean(expandedQuotedIds[msg.messageId]);

          return (
            <div
              key={msg.messageId}
              className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
            >
              <article
                style={{
                  backgroundColor: isOutgoing ? 'var(--v-bubble-out-bg)' : 'var(--v-bubble-in-bg)',
                  color: isOutgoing ? 'var(--v-bubble-out-text)' : 'var(--v-bubble-in-text)'
                }}
                className={`max-w-[85%] sm:max-w-[72%] rounded-2xl px-4 py-3 shadow-xs ${
                  isOutgoing
                    ? 'rounded-br-sm'
                    : 'border border-[var(--v-border)] rounded-bl-sm'
                }`}
              >
                {!isOutgoing && (
                  <header className="flex items-baseline justify-between gap-3 mb-1.5">
                    <span className="text-xs font-semibold text-[var(--v-secondary)]">
                      {msg.senderName}
                    </span>
                    <span className="text-[11px] text-[var(--v-muted)] truncate">
                      {msg.senderEmail}
                    </span>
                  </header>
                )}

                {showHtml && msg.bodyHtmlSanitized ? (
                  <div
                    className={`vartalap-email-html rounded-xl p-3 ${
                      isOutgoing
                        ? 'bg-white text-[#252D2B]'
                        : 'bg-[var(--v-bg)] text-[var(--v-text)]'
                    }`}
                    dangerouslySetInnerHTML={{ __html: msg.bodyHtmlSanitized }}
                  />
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {msg.bodyPlain}
                  </p>
                )}

                {/* Controls for Rich HTML & Quoted Content */}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {msg.bodyHtmlSanitized && (
                    <button
                      type="button"
                      onClick={() =>
                        setHtmlModeIds((prev) => ({
                          ...prev,
                          [msg.messageId]: !prev[msg.messageId]
                        }))
                      }
                      className={`text-xs font-medium underline underline-offset-2 ${
                        isOutgoing ? 'text-white/90 hover:text-white' : 'text-[var(--v-secondary)]'
                      }`}
                    >
                      {showHtml ? 'Plain text view' : 'Sanitized HTML view'}
                    </button>
                  )}

                  {msg.quotedText && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedQuotedIds((prev) => ({
                          ...prev,
                          [msg.messageId]: !prev[msg.messageId]
                        }))
                      }
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        isOutgoing
                          ? 'text-white/85 hover:text-white'
                          : 'text-[var(--v-muted)] hover:text-[var(--v-text)]'
                      }`}
                    >
                      {showQuoted ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          <span>Hide quoted reply</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Show quoted reply</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {showQuoted && msg.quotedText && (
                  <div
                    className={`mt-2 p-2.5 rounded-xl text-xs whitespace-pre-wrap break-words ${
                      isOutgoing
                        ? 'bg-black/15 text-white/90'
                        : 'bg-[var(--v-bg)] text-[var(--v-muted)]'
                    }`}
                  >
                    {msg.quotedText}
                  </div>
                )}

                {/* Attachments streamed directly from Gmail */}
                {msg.attachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {msg.attachments.map((att) => {
                      const isImage = att.mimeType.startsWith('image/');
                      const previewUrl = attachmentPreviews[att.id];
                      return (
                        <div key={att.id} className="space-y-1.5">
                          {previewUrl && isImage && (
                            <img
                              src={previewUrl}
                              alt={att.fileName}
                              className="max-h-56 rounded-xl object-contain bg-black/5"
                            />
                          )}
                          <div
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl ${
                              isOutgoing
                                ? 'bg-black/15 text-white'
                                : 'bg-[var(--v-surface-alt)] text-[var(--v-text)]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {isImage ? (
                                <ImageIcon className="w-4 h-4 shrink-0" />
                              ) : (
                                <FileText className="w-4 h-4 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{att.fileName}</p>
                                <p
                                  className={`text-[11px] tabular-nums ${
                                    isOutgoing ? 'text-white/75' : 'text-[var(--v-muted)]'
                                  }`}
                                >
                                  {formatFileSize(att.sizeBytes)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleAttachmentDownload(att)}
                                disabled={downloadingId === att.id}
                                aria-label={`Download ${att.fileName}`}
                                title="Download from Gmail"
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              {driveEnabled && (
                                <button
                                  type="button"
                                  onClick={() => onSaveAttachmentToDrive(att)}
                                  aria-label={`Save ${att.fileName} to your Google Drive`}
                                  title="Save to my Google Drive"
                                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
                                >
                                  <CloudUpload className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <footer
                  className={`mt-2 flex items-center justify-end gap-1.5 text-[11px] tabular-nums ${
                    isOutgoing ? 'text-white/80' : 'text-[var(--v-muted)]'
                  }`}
                >
                  <span>{formatMessageTime(msg.timestampMillis)}</span>
                  {isOutgoing && (
                    <>
                      <span>·</span>
                      <span>
                        {msg.sendStatus === 'sending'
                          ? 'Sending...'
                          : msg.sendStatus === 'failed'
                            ? 'Failed'
                            : 'Sent via Gmail'}
                      </span>
                      {msg.sendStatus === 'sending' ? (
                        <Clock className="w-3 h-3" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </>
                  )}
                </footer>
              </article>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <footer className="bg-[var(--v-surface)] border-t border-[var(--v-border)] px-4 sm:px-6 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center p-0.5 rounded-xl bg-[var(--v-surface-alt)]">
            <button
              type="button"
              onClick={() => setReplyAll(false)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                !replyAll
                  ? 'bg-[var(--v-surface)] text-[var(--v-text)] shadow-xs'
                  : 'text-[var(--v-muted)]'
              }`}
            >
              Reply
            </button>
            <button
              type="button"
              onClick={() => setReplyAll(true)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                replyAll
                  ? 'bg-[var(--v-surface)] text-[var(--v-text)] shadow-xs'
                  : 'text-[var(--v-muted)]'
              }`}
            >
              Reply All
            </button>
          </div>
          <span className="text-xs text-[var(--v-muted)] truncate">
            Standard Gmail reply · Threading preserved
          </span>
        </div>

        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map((file) => (
              <div
                key={file.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--v-surface-alt)] text-xs text-[var(--v-text)]"
              >
                <span className="truncate max-w-[180px]">{file.fileName}</span>
                <span className="text-[var(--v-muted)] tabular-nums">
                  {formatFileSize(file.sizeBytes)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.fileName}`}
                  onClick={() =>
                    setPendingAttachments((prev) => prev.filter((item) => item.id !== file.id))
                  }
                  className="text-[var(--v-muted)] hover:text-[var(--v-text)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[var(--v-border)] text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)] transition-colors shrink-0"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <textarea
            rows={1}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleTriggerSend();
              }
            }}
            placeholder="Write a reply via Gmail..."
            className="flex-1 min-h-[44px] max-h-32 px-4 py-2.5 text-sm rounded-xl bg-[var(--v-bg)] text-[var(--v-text)] placeholder:text-[var(--v-muted)]/75 border border-[var(--v-border)] focus:border-[var(--v-secondary)] focus:outline-none resize-none"
          />

          <button
            type="button"
            onClick={handleTriggerSend}
            disabled={!composerText.trim() || isSending}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-sm font-semibold inline-flex items-center gap-2 transition-opacity disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>{isSending ? 'Sending...' : 'Send'}</span>
          </button>
        </div>
      </footer>

      {/* Conversation Details Modal */}
      {detailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--v-border)]">
              <h3 id="details-title" className="text-base font-semibold text-[var(--v-text)]">
                Conversation Details
              </h3>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label="Close conversation details"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[var(--v-muted)] hover:bg-[var(--v-surface-alt)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="space-y-2.5">
                <div>
                  <span className="text-[var(--v-muted)] block">Subject</span>
                  <span className="text-sm font-medium text-[var(--v-text)]">{thread.subject}</span>
                </div>
                <div>
                  <span className="text-[var(--v-muted)] block">From</span>
                  <span className="text-[var(--v-text)]">
                    {latestMessage
                      ? `${latestMessage.senderName} <${latestMessage.senderEmail}>`
                      : thread.contactEmail}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--v-muted)] block">To</span>
                  <span className="text-[var(--v-text)]">
                    {latestMessage?.toEmails.join(', ') || '-'}
                  </span>
                </div>
                {latestMessage && latestMessage.ccEmails.length > 0 && (
                  <div>
                    <span className="text-[var(--v-muted)] block">Cc</span>
                    <span className="text-[var(--v-text)]">
                      {latestMessage.ccEmails.join(', ')}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-[var(--v-muted)] block">Received</span>
                  <span className="text-[var(--v-text)] tabular-nums">
                    {formatMessageTime(thread.lastMessageTimestamp)}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--v-muted)] block">Gmail Thread ID</span>
                  <span className="font-mono text-[var(--v-text)]">{thread.threadId}</span>
                </div>
                {latestMessage?.rfcMessageIdHeader && (
                  <div>
                    <span className="text-[var(--v-muted)] block">Message-ID</span>
                    <span className="font-mono text-[var(--v-text)] break-all">
                      {latestMessage.rfcMessageIdHeader}
                    </span>
                  </div>
                )}
                {latestMessage?.inReplyToHeader && (
                  <div>
                    <span className="text-[var(--v-muted)] block">In-Reply-To</span>
                    <span className="font-mono text-[var(--v-text)] break-all">
                      {latestMessage.inReplyToHeader}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[var(--v-border)] space-y-2">
                <p className="font-semibold text-[var(--v-text)]">Conversation Category</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_CHOICES.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => onSetCategory(thread.threadId, choice.id)}
                      className={`px-3 py-1.5 rounded-xl font-semibold transition-colors ${
                        thread.category === choice.id
                          ? 'bg-[var(--v-primary)] text-white'
                          : 'bg-[var(--v-surface-alt)] text-[var(--v-muted)] hover:text-[var(--v-text)]'
                      }`}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-[var(--v-surface-alt)] border border-[var(--v-border)] p-3 text-[var(--v-muted)] leading-relaxed">
                Email Transparency: Messages in Vartalap are standard Gmail emails transmitted over
                HTTPS/TLS through your Google account. They are not end-to-end encrypted chat.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
