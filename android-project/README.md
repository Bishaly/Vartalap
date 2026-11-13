# Vartalap — Conversations, made simple.

**Package Name:** `com.nextgen.vartalap`  
**Platform:** Android (Kotlin, Jetpack Compose, Material 3)  
**Architecture:** User-Owned Direct-to-Google Architecture (Zero Developer Infrastructure)

---

## 1. Product Design & Navigation Architecture

Vartalap presents a calm, original Deep Forest & Jade visual identity with three selectable themes in Settings:
- **Forest & Mint** (default): Deep Forest `#183B38`, Jade Green `#237D68`, Mint Mist `#DCEBE2`, Soft Ivory `#F5F7F4`
- **Soft Ivory**: Warm minimalist light palette
- **Midnight Jade**: High-contrast dark jade theme

Navigation separates communication into two focused areas:
1. **Conversations**: Person-centered threads grouped by real Gmail `threadId`, keeping newsletters, promotions, and automated headers separated automatically (with manual category overrides for `Personal`, `Work`, `Important`, `Automated`). Includes filter chips (`All`, `Unread`, `Important`, `Work`, `Personal`) and `"Find a conversation..."` search.
2. **Email Folder**: Traditional folder view for `Inbox`, `Sent`, `Drafts`, `Starred`, `Spam`, `Trash`, and `Archive` fetched lazily via Gmail API labels/queries without downloading the entire mailbox.
3. **Conversation Details & Transparency**: Every chat header provides an Info view displaying `From`, `To`/`Cc`, original `Subject`, received timestamp, `threadId`, `Message-ID`, `In-Reply-To`, `References`, manual categorization, and an explicit notice that Gmail emails travel over HTTPS/TLS rather than end-to-end encrypted chat.

---

## 2. User-Owned Google Storage Architecture

Vartalap operates **with zero developer-owned servers, databases, or cloud storage**:

```text
Android App ──▶ Google OAuth 2.0 (PKCE) ──▶ Gmail API ──▶ User's Own Gmail
                                        └──▶ Drive API ──▶ User's Own Google Drive (Optional)
```

- **Gmail as Source of Truth**: Threads, messages, and attachments are fetched directly from the authenticated user's Gmail account.
- **No Room / No SQLite / No Remote Database**: Conversations and messages reside strictly in active session memory (`InMemorySessionStore`). Only minimal app preferences (theme, notification preference, sync interval, optional Drive flag, manual category overrides) live in `androidx.datastore:datastore-preferences`.
- **Optional User-Owned Google Drive**: Drive permissions (`drive.file`, `drive.readonly`) are requested **only** when the user explicitly enables Google Drive in Settings. Users can save selected email attachments to their own Drive or browse files they choose—attachments are never automatically bulk-uploaded.
- **SAF Attachment Saving**: Downloaded files use Android Storage Access Framework (`ActivityResultContracts.CreateDocument`), and temporary previews use private deletable `cacheDir`.

---

## 3. Background Sync & Push Notification Limitations

Because Vartalap uses **no developer-operated backend server**:
- Background synchronization runs periodically via **Android WorkManager** (`GmailSyncWorker`), which enforces a **15-minute minimum periodic interval** and checks Gmail History deltas directly.
- Instant push notifications are intentionally **not** promised without a user-provisioned or backend push relay (such as Gmail `users.watch()` + Google Cloud Pub/Sub + FCM).

---

## 4. Google Cloud Console & Android OAuth 2.0 Setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select a project.
2. Enable **Gmail API** (`gmail.googleapis.com`) and optionally **Google Drive API** (`drive.googleapis.com`).
3. Configure **OAuth Consent Screen** (External, App Name: `Vartalap`, add your Gmail under **Test users**).
4. Create an **OAuth 2.0 Client ID** of type **Android**:
   - **Package name:** `com.nextgen.vartalap`
   - **SHA-1 fingerprint:**
     ```bash
     keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
     ```
5. Set `vartalap.oauthClientId=YOUR_CLIENT_ID.apps.googleusercontent.com` in `local.properties`.

---

## 5. Building Debug & Signed Release APKs

```bash
cd android-project
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk

./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```
