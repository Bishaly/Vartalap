import { useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import type { PendingConfirmation } from '../types';

interface ConfirmationModalProps {
  confirmation: PendingConfirmation | null;
  onClose: () => void;
}

export function ConfirmationModal({ confirmation, onClose }: ConfirmationModalProps) {
  const [isExecuting, setIsExecuting] = useState(false);

  if (!confirmation) return null;

  const handleConfirm = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    try {
      await confirmation.onConfirm();
      onClose();
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                confirmation.destructive
                  ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              }`}
            >
              {confirmation.destructive ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <h2
              id="confirm-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {confirmation.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            aria-label="Close confirmation dialog"
            className="min-h-[40px] min-w-[40px] -mr-2 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {confirmation.description}
          </p>
          {confirmation.details.length > 0 && (
            <ul className="space-y-1.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300">
              {confirmation.details.map((item, index) => (
                <li key={index} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className="min-h-[40px] px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isExecuting}
            className={`min-h-[40px] px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors whitespace-nowrap disabled:opacity-60 ${
              confirmation.destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {isExecuting ? 'Processing...' : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
