import { useRef, useState, type ChangeEvent } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import type { OutgoingAttachmentFile } from '../types';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (params: {
    toEmails: string[];
    subject: string;
    bodyText: string;
    attachments: OutgoingAttachmentFile[];
    onSuccess: () => void;
  }) => void;
  isSending: boolean;
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

export function NewConversationModal({
  isOpen,
  onClose,
  onSubmit,
  isSending
}: NewConversationModalProps) {
  const [toInput, setToInput] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [attachments, setAttachments] = useState<OutgoingAttachmentFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const loaded = await Promise.all(
      files.map(async (f) => ({
        id: `${f.name}_${f.size}_${Date.now()}`,
        fileName: f.name,
        mimeType: f.type || 'application/octet-stream',
        sizeBytes: f.size,
        base64Content: await readFileAsBase64(f)
      }))
    );
    setAttachments((prev) => [...prev, ...loaded]);
    e.target.value = '';
  };

  const recipients = toInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const canSubmit =
    recipients.length > 0 && subject.trim().length > 0 && bodyText.trim().length > 0 && !isSending;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conv-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 id="new-conv-title" className="text-base font-semibold text-slate-900 dark:text-white">
            New Email Conversation
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new conversation dialog"
            className="min-h-[40px] min-w-[40px] -mr-2 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Recipient Email(s)
            </label>
            <input
              type="email"
              multiple
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              placeholder="alex@example.com, team@example.com"
              className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Project kickoff"
              className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Message
            </label>
            <textarea
              rows={5}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Write your message..."
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none resize-y"
            />
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200"
                >
                  <span className="truncate max-w-[180px]">{att.fileName}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2"
            >
              <Paperclip className="w-4 h-4" />
              <span>Attach Files</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() =>
                onSubmit({
                  toEmails: recipients,
                  subject: subject.trim(),
                  bodyText: bodyText.trim(),
                  attachments,
                  onSuccess: () => {
                    setToInput('');
                    setSubject('');
                    setBodyText('');
                    setAttachments([]);
                    onClose();
                  }
                })
              }
              className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? 'Sending...' : 'Review & Send'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
