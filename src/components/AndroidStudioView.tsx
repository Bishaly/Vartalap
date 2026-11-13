import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Check, Copy, Download, FileCode2, FolderOpen, Terminal } from 'lucide-react';

const rawProjectFiles = import.meta.glob('/android-project/**/*', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

interface ProjectFileEntry {
  path: string;
  content: string;
}

export function AndroidStudioView() {
  const files: ProjectFileEntry[] = useMemo(() => {
    return Object.entries(rawProjectFiles)
      .map(([fullPath, content]) => ({
        path: fullPath.replace(/^\/android-project\//, ''),
        content: typeof content === 'string' ? content : ''
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, []);

  const [selectedPath, setSelectedPath] = useState<string>(
    () => files.find((f) => f.path === 'README.md')?.path ?? files[0]?.path ?? ''
  );
  const [filterText, setFilterText] = useState('');
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const visibleFiles = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, filterText]);

  const activeFile = files.find((f) => f.path === selectedPath) ?? visibleFiles[0] ?? null;

  const handleDownloadZip = async () => {
    if (isZipping || files.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      files.forEach((f) => {
        zip.file(`vartalap-android/${f.path}`, f.content);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vartalap-android-studio-project.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsZipping(false);
    }
  };

  const handleCopyFile = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--v-text)]">
            Vartalap Android Studio Project
          </h2>
          <p className="text-sm text-[var(--v-muted)] mt-1">
            Complete Kotlin, Jetpack Compose, DataStore, In-Memory Session, WorkManager, Keystore,
            Gmail API, and optional user Drive project for{' '}
            <span className="font-mono text-xs">com.nextgen.vartalap</span> ({files.length} files).
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          disabled={isZipping || files.length === 0}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-sm font-semibold inline-flex items-center gap-2 transition-opacity disabled:opacity-50 whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          <span>{isZipping ? 'Packaging ZIP...' : 'Download Android Project (.zip)'}</span>
        </button>
      </div>

      {/* Build & Google Cloud Setup Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Terminal className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Build Debug &amp; Signed Release APK</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            This web runtime container does not include the Android SDK or Gradle daemon, so export
            the ZIP above and build directly in Android Studio or CLI:
          </p>
          <pre className="p-3 rounded-xl bg-slate-950 text-slate-100 text-xs overflow-x-auto leading-relaxed">
{`./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk

./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk`}
          </pre>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <FolderOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Google Cloud Console Android OAuth Checklist</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Enable Gmail API, add test users on the OAuth consent screen, create an Android OAuth
            Client ID for <span className="font-mono">com.nextgen.vartalap</span> with your SHA-1,
            and set <span className="font-mono">vartalap.oauthClientId</span> in{' '}
            <span className="font-mono">local.properties</span>:
          </p>
          <pre className="p-3 rounded-xl bg-slate-950 text-slate-100 text-xs overflow-x-auto leading-relaxed">
{`keytool -list -v -keystore ~/.android/debug.keystore \\
  -alias androiddebugkey -storepass android -keypass android`}
          </pre>
        </div>
      </div>

      {/* File Explorer + Code Viewer */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[560px]">
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800">
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter Kotlin / Gradle / XML files..."
              className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto max-h-[500px] divide-y divide-slate-100 dark:divide-slate-800/70">
            {visibleFiles.map((file) => {
              const selected = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 text-xs font-mono transition-colors ${
                    selected
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{file.path}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="lg:col-span-8 flex flex-col bg-slate-950 text-slate-100">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-slate-300 truncate">
              {activeFile?.path ?? 'No file selected'}
            </span>
            {activeFile && (
              <button
                type="button"
                onClick={handleCopyFile}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          <pre className="flex-1 p-4 text-xs font-mono leading-relaxed overflow-auto max-h-[520px]">
            <code>{activeFile?.content ?? ''}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
