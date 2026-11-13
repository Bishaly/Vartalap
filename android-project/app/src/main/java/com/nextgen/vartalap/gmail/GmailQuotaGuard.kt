package com.nextgen.vartalap.gmail

import android.util.Log
import okhttp3.Headers
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

class GmailQuotaExceededException(
    val retryAfterSeconds: Long,
    message: String = buildFriendlyMessage(retryAfterSeconds)
) : IOException(message) {
    companion object {
        fun buildFriendlyMessage(retryAfterSeconds: Long): String {
            return if (retryAfterSeconds > 0L) {
                "Gmail is temporarily busy due to API rate limits. Showing cached conversations — please wait ${retryAfterSeconds}s before syncing again."
            } else {
                "Gmail is temporarily busy due to API rate limits. Showing cached conversations — please wait a moment before syncing again."
            }
        }
    }
}

/**
 * Coordinates Gmail API rate-limit cooldowns, parses Retry-After headers,
 * and logs per-endpoint call counts & cache hits to Logcat (no UI/PII exposure).
 */
class GmailQuotaGuard {

    private val cooldownUntilMillis = AtomicLong(0L)
    private val endpointCallCounts = ConcurrentHashMap<String, AtomicInteger>()
    private val cacheHitCounts = ConcurrentHashMap<String, AtomicInteger>()

    fun remainingCooldownSeconds(nowMillis: Long = System.currentTimeMillis()): Long {
        val until = cooldownUntilMillis.get()
        if (until <= nowMillis) return 0L
        return ((until - nowMillis) + 999L) / 1000L
    }

    fun isCoolingDown(nowMillis: Long = System.currentTimeMillis()): Boolean =
        remainingCooldownSeconds(nowMillis) > 0L

    fun recordCooldown(retryAfterSeconds: Long, nowMillis: Long = System.currentTimeMillis()) {
        val clampedSeconds = retryAfterSeconds.coerceIn(10L, 180L)
        val targetUntil = nowMillis + clampedSeconds * 1000L
        cooldownUntilMillis.updateAndGet { current -> maxOf(current, targetUntil) }
        Log.w(TAG, "Gmail API cooldown activated for ${clampedSeconds}s")
    }

    fun clearCooldown() {
        cooldownUntilMillis.set(0L)
    }

    fun logApiCall(endpointKey: String, statusCode: Int, durationMs: Long) {
        val total = endpointCallCounts
            .getOrPut(endpointKey) { AtomicInteger(0) }
            .incrementAndGet()
        Log.d(
            TAG,
            "API call [$endpointKey] status=$statusCode duration=${durationMs}ms sessionCount=$total"
        )
    }

    fun logCacheHit(cacheKey: String) {
        val total = cacheHitCounts
            .getOrPut(cacheKey) { AtomicInteger(0) }
            .incrementAndGet()
        Log.d(TAG, "Cache hit [$cacheKey] savedNetworkCall=true totalHits=$total")
    }

    fun parseRetryAfterSeconds(headers: Headers): Long? {
        val raw = headers["Retry-After"]?.trim()
        if (raw.isNullOrBlank()) return null

        raw.toLongOrNull()?.let { seconds ->
            return seconds.coerceIn(1L, 180L)
        }

        return runCatching {
            val fmt = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("GMT")
            }
            val parsedDate = fmt.parse(raw) ?: return@runCatching null
            val diffSeconds = (parsedDate.time - System.currentTimeMillis()) / 1000L
            diffSeconds.coerceIn(1L, 180L)
        }.getOrNull()
    }

    fun classifyEndpoint(method: String, path: String, query: String?): String {
        return when {
            path.endsWith("/profile") -> "profile.get"
            path.endsWith("/history") -> "history.list"
            path.endsWith("/threads") -> "threads.list"
            path.contains("/threads/") && path.endsWith("/modify") -> "threads.modify"
            path.contains("/threads/") -> {
                val format = if (query?.contains("format=metadata") == true) "metadata" else "full"
                "threads.get($format)"
            }
            path.endsWith("/messages/send") -> "messages.send"
            path.contains("/attachments/") -> "attachments.get"
            path.contains("/messages/") -> "messages.get"
            else -> "$method:$path"
        }
    }

    companion object {
        private const val TAG = "VartalapGmailQuota"
    }
}
