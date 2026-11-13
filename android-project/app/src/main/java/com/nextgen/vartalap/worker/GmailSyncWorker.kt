package com.nextgen.vartalap.worker

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.nextgen.vartalap.VartalapApp
import com.nextgen.vartalap.domain.ConversationFilter
import com.nextgen.vartalap.gmail.GmailQuotaExceededException
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

class GmailSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val app = applicationContext as VartalapApp
        val repository = app.container.repository
        val notifications = app.container.notificationManager
        val quotaGuard = app.container.quotaGuard

        if (!app.container.oauthManager.hasAuthenticatedSession()) {
            return Result.success()
        }

        // Do not run background sync during an active rate-limit cooldown
        if (quotaGuard.isCoolingDown()) {
            quotaGuard.logCacheHit("worker.cooldown_skip")
            return Result.success()
        }

        // Skip background sync if foreground synced recently (within 5 minutes)
        val currentSettings = repository.settings.first()
        val elapsedMs = System.currentTimeMillis() - currentSettings.lastSyncTimestamp
        if (currentSettings.lastSyncTimestamp > 0L && elapsedMs < MIN_BACKGROUND_GAP_MS) {
            quotaGuard.logCacheHit("worker.recent_sync_skip")
            return Result.success()
        }

        val syncResult = repository.syncInitialOrIncremental(forceFull = false)
        return syncResult.fold(
            onSuccess = { newlySyncedCount ->
                if (newlySyncedCount > 0 && currentSettings.notificationsEnabled) {
                    val latestUnread = repository.observeConversations(ConversationFilter.ALL, "")
                        .first()
                        .firstOrNull { it.unreadCount > 0 }
                    if (latestUnread != null) {
                        notifications.showIncomingMessageNotification(
                            threadId = latestUnread.threadId,
                            senderName = latestUnread.contactName,
                            preview = latestUnread.lastMessagePreview,
                            timestampMillis = latestUnread.lastMessageTimestamp
                        )
                    }
                }
                Result.success()
            },
            onFailure = { err ->
                // Never pile retries onto a rate-limited user; wait for the next scheduled periodic window
                if (err is GmailQuotaExceededException || quotaGuard.isCoolingDown()) {
                    Result.success()
                } else {
                    Result.retry()
                }
            }
        )
    }

    companion object {
        private const val MIN_BACKGROUND_GAP_MS = 5 * 60 * 1000L
    }
}

object SyncScheduler {
    private const val UNIQUE_PERIODIC_SYNC_NAME = "vartalap_gmail_periodic_sync"

    /**
     * WorkManager enforces a 15-minute minimum interval for periodic background jobs.
     * Because Vartalap uses zero developer-operated servers, instant push notifications
     * are intentionally not promised; periodic sync polls the user's Gmail directly.
     */
    fun schedulePeriodicSync(context: Context, intervalMinutes: Int) {
        val safeInterval = intervalMinutes.coerceAtLeast(15).toLong()
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = PeriodicWorkRequestBuilder<GmailSyncWorker>(
            safeInterval,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC_SYNC_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    fun cancelPeriodicSync(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC_SYNC_NAME)
    }
}
