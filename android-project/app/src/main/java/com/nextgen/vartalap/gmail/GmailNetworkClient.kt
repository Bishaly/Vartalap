package com.nextgen.vartalap.gmail

import android.util.Log
import com.nextgen.vartalap.authentication.GoogleOAuthManager
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import kotlin.random.Random

object GmailNetworkClient {

    private const val BASE_URL = "https://gmail.googleapis.com/"
    private const val TAG = "VartalapGmailQuota"
    private const val MAX_RATE_LIMIT_RETRIES = 3

    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    fun createOkHttpClient(
        oauthManager: GoogleOAuthManager,
        quotaGuard: GmailQuotaGuard
    ): OkHttpClient {
        val authAndQuotaInterceptor = Interceptor { chain ->
            val remainingCooldown = quotaGuard.remainingCooldownSeconds()
            if (remainingCooldown > 0L) {
                throw GmailQuotaExceededException(remainingCooldown)
            }

            val token = kotlinx.coroutines.runBlocking { oauthManager.getValidAccessToken() }
            val original = chain.request()
            val authedRequest = if (!token.isNullOrBlank()) {
                original.newBuilder()
                    .header("Authorization", "Bearer $token")
                    .build()
            } else {
                original
            }

            val endpointKey = quotaGuard.classifyEndpoint(
                method = authedRequest.method,
                path = authedRequest.url.encodedPath,
                query = authedRequest.url.encodedQuery
            )

            var attempt = 0
            while (true) {
                val startNs = System.nanoTime()
                val response = chain.proceed(authedRequest)
                val durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNs)
                quotaGuard.logApiCall(endpointKey, response.code, durationMs)

                val isRateLimited = isQuotaOrRateLimitResponse(response)
                if (!isRateLimited) {
                    return@Interceptor response
                }

                val retryAfterHeader = quotaGuard.parseRetryAfterSeconds(response.headers)
                if (attempt >= MAX_RATE_LIMIT_RETRIES) {
                    val cooldownSecs = retryAfterHeader ?: 60L
                    quotaGuard.recordCooldown(cooldownSecs)
                    response.close()
                    throw GmailQuotaExceededException(cooldownSecs)
                }

                response.close()
                attempt++
                val delayMs = computeBackoffWithJitterMs(attempt, retryAfterHeader)
                Log.w(
                    TAG,
                    "Rate limit on [$endpointKey] (attempt $attempt/$MAX_RATE_LIMIT_RETRIES), backing off ${delayMs}ms"
                )
                try {
                    Thread.sleep(delayMs)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw GmailQuotaExceededException(retryAfterHeader ?: 30L)
                }
            }
        }

        return OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(authAndQuotaInterceptor)
            .build()
    }

    private fun isQuotaOrRateLimitResponse(response: Response): Boolean {
        if (response.code == 429 || response.code == 503) return true
        if (response.code != 403) return false
        val bodySnippet = runCatching {
            response.peekBody(8192).string().lowercase()
        }.getOrDefault("")
        return bodySnippet.contains("ratelimitexceeded") ||
            bodySnippet.contains("userratelimitexceeded") ||
            bodySnippet.contains("quotaexceeded") ||
            bodySnippet.contains("total query cost") ||
            bodySnippet.contains("quota")
    }

    private fun computeBackoffWithJitterMs(attempt: Int, retryAfterSeconds: Long?): Long {
        if (retryAfterSeconds != null && retryAfterSeconds > 0L) {
            val clamped = retryAfterSeconds.coerceAtMost(30L)
            val jitter = Random.nextLong(150L, 650L)
            return clamped * 1000L + jitter
        }
        val baseMs = 1000L * (1L shl (attempt - 1)) // 1s, 2s, 4s
        val jitter = Random.nextLong(200L, 750L)
        return baseMs + jitter
    }

    fun createApiService(okHttpClient: OkHttpClient): GmailApiService {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
            .create(GmailApiService::class.java)
    }
}
