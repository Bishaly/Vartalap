import { ArrowRight, Code2, Lock, MailCheck, Shield } from 'lucide-react';
import { BrandMark } from './BrandMark';

interface WelcomeViewProps {
  onSignIn: () => void;
  onOpenAndroidStudio: () => void;
  isSigningIn: boolean;
  authError: string | null;
}

export function WelcomeView({
  onSignIn,
  onOpenAndroidStudio,
  isSigningIn,
  authError
}: WelcomeViewProps) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-10 bg-[var(--v-bg)]">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left: Primary Authentication Card */}
        <section className="lg:col-span-7 rounded-3xl bg-[var(--v-surface)] border border-[var(--v-border)] p-8 sm:p-10 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center gap-4 mb-8">
              <BrandMark size="lg" />
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--v-text)]">
                  Vartalap
                </h1>
                <p className="text-sm sm:text-base text-[var(--v-secondary)] font-medium mt-0.5">
                  Conversations, made simple.
                </p>
              </div>
            </div>

            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--v-text)] leading-snug max-w-xl text-balance">
              Calm, person-centered conversations built directly on your real Gmail account.
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[var(--v-muted)] leading-relaxed max-w-xl">
              Personal conversations stay front and center, while newsletters and automated alerts
              remain organized in traditional Gmail folders—Inbox, Sent, Drafts, Starred, Spam,
              Trash, and Archive.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            {authError && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-800 dark:text-red-200"
              >
                {authError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSignIn}
                disabled={isSigningIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span>{isSigningIn ? 'Connecting Gmail...' : 'Continue with Google'}</span>
                </div>
              </button>

              <button
                type="button"
                onClick={onOpenAndroidStudio}
                className="min-h-[48px] px-5 py-2.5 rounded-xl border border-[var(--v-border)] text-sm font-semibold text-[var(--v-text)] hover:bg-[var(--v-surface-alt)] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Code2 className="w-4 h-4 text-[var(--v-secondary)]" />
                <span>Android Studio Project</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="pt-4 border-t border-[var(--v-border)] flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--v-muted)]">
              <span>Package: com.nextgen.vartalap</span>
              <span aria-hidden="true">·</span>
              <span>Gmail API v1</span>
              <span aria-hidden="true">·</span>
              <span>Zero developer database</span>
            </div>
          </div>
        </section>

        {/* Right: Trust & Architecture Overview */}
        <aside className="lg:col-span-5 rounded-3xl bg-[var(--v-surface-alt)] border border-[var(--v-border)] p-8 flex flex-col justify-between gap-6">
          <div className="space-y-5">
            <h3 className="text-base font-semibold text-[var(--v-text)]">
              Private &amp; User-Owned Architecture
            </h3>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-[var(--v-secondary)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[var(--v-text)]">
                    User-Owned Google Storage Only
                  </p>
                  <p className="text-xs text-[var(--v-muted)] mt-0.5 leading-relaxed">
                    Zero developer servers, Room/SQLite databases, or remote storage. Conversations
                    live in active session memory directly from your Gmail.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <MailCheck className="w-5 h-5 text-[var(--v-secondary)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[var(--v-text)]">
                    Smart Thread Grouping &amp; Folders
                  </p>
                  <p className="text-xs text-[var(--v-muted)] mt-0.5 leading-relaxed">
                    Groups threads by real Gmail threadId, separates bulk and automated mail, and
                    lets you manually categorize any thread.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-[var(--v-secondary)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[var(--v-text)]">
                    Honest Gmail Delivery &amp; Confirmation
                  </p>
                  <p className="text-xs text-[var(--v-muted)] mt-0.5 leading-relaxed">
                    Standard Gmail delivery over HTTPS/TLS with full header transparency and explicit
                    confirmation before sending or modifying mail.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--v-border)] text-xs text-[var(--v-muted)]">
            Includes complete Kotlin, Jetpack Compose, DataStore, WorkManager, and Gradle APK build
            files ready to export.
          </div>
        </aside>
      </div>
    </div>
  );
}
