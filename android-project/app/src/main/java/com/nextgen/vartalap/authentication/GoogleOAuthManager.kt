package com.nextgen.vartalap.authentication

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.nextgen.vartalap.BuildConfig
import com.nextgen.vartalap.security.SecureTokenStorage
import com.nextgen.vartalap.security.StoredTokenBundle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import net.openid.appauth.TokenRequest
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import kotlin.coroutines.resume

object GoogleOAuthScopes {
    const val GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly"
    const val GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send"
    const val GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify"
    const val DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"
    const val DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly"
    const val EMAIL = "email"
    const val PROFILE = "profile"

    val INITIAL_GMAIL_SCOPES = listOf(GMAIL_READONLY, GMAIL_SEND, EMAIL, PROFILE)
    val OPTIONAL_DRIVE_SCOPES = listOf(DRIVE_FILE, DRIVE_READONLY)
}

class GoogleOAuthManager(
    context: Context,
    private val tokenStorage: SecureTokenStorage,
    private val httpClient: OkHttpClient
) {
    private val appContext = context.applicationContext
    private val authService = AuthorizationService(appContext)

    private val serviceConfig = AuthorizationServiceConfiguration(
        Uri.parse("https://accounts.google.com/o/oauth2/v2/auth"),
        Uri.parse("https://oauth2.googleapis.com/token")
    )

    fun isConfigured(): Boolean = BuildConfig.OAUTH_CLIENT_ID.isNotBlank()

    fun buildAuthorizationIntent(additionalScopes: List<String> = emptyList()): Intent {
        val existingScopes = tokenStorage.loadTokens()?.grantedScopes.orEmpty()
        val combined = (GoogleOAuthScopes.INITIAL_GMAIL_SCOPES + existingScopes + additionalScopes).distinct()

        val request = AuthorizationRequest.Builder(
            serviceConfig,
            BuildConfig.OAUTH_CLIENT_ID,
            ResponseTypeValues.CODE,
            Uri.parse(BuildConfig.OAUTH_REDIRECT_URI)
        )
            .setScopes(combined)
            .setAdditionalParameters(
                mapOf(
                    "access_type" to "offline",
                    "prompt" to "consent"
                )
            )
            .build()

        return authService.getAuthorizationRequestIntent(request)
    }

    fun buildDriveConsentIntent(): Intent =
        buildAuthorizationIntent(GoogleOAuthScopes.OPTIONAL_DRIVE_SCOPES)

    fun buildModifyConsentIntent(): Intent =
        buildAuthorizationIntent(listOf(GoogleOAuthScopes.GMAIL_MODIFY))

    suspend fun handleAuthorizationResponse(intent: Intent): Result<StoredTokenBundle> =
        withContext(Dispatchers.IO) {
            val response = AuthorizationResponse.fromIntent(intent)
            val exception = AuthorizationException.fromIntent(intent)

            if (exception != null) {
                return@withContext Result.failure(
                    IllegalStateException(exception.errorDescription ?: "Authorization cancelled")
                )
            }
            if (response == null) {
                return@withContext Result.failure(
                    IllegalStateException("Missing OAuth authorization response")
                )
            }

            exchangeToken(
                response.createTokenExchangeRequest(),
                existingScopes = response.scopeSet.orEmpty()
            )
        }

    suspend fun getValidAccessToken(): String? = withContext(Dispatchers.IO) {
        val current = tokenStorage.loadTokens() ?: return@withContext null
        val now = System.currentTimeMillis()
        if (current.expiresAtMillis > now + 60_000L) {
            return@withContext current.accessToken
        }

        val refreshToken = current.refreshToken ?: return@withContext null
        val refreshRequest = TokenRequest.Builder(serviceConfig, BuildConfig.OAUTH_CLIENT_ID)
            .setGrantType("refresh_token")
            .setRefreshToken(refreshToken)
            .build()

        val refreshed = exchangeToken(
            refreshRequest,
            fallbackRefreshToken = refreshToken,
            existingScopes = current.grantedScopes
        )
        refreshed.getOrNull()?.accessToken
    }

    fun hasModifyScope(): Boolean {
        val tokens = tokenStorage.loadTokens() ?: return false
        return tokens.grantedScopes.contains(GoogleOAuthScopes.GMAIL_MODIFY)
    }

    fun hasDriveScope(): Boolean {
        val tokens = tokenStorage.loadTokens() ?: return false
        return tokens.grantedScopes.contains(GoogleOAuthScopes.DRIVE_FILE)
    }

    fun hasAuthenticatedSession(): Boolean = tokenStorage.loadTokens() != null

    suspend fun revokeAndClearTokens() = withContext(Dispatchers.IO) {
        val tokens = tokenStorage.loadTokens()
        val tokenToRevoke = tokens?.refreshToken ?: tokens?.accessToken
        if (!tokenToRevoke.isNullOrBlank()) {
            runCatching {
                val form = FormBody.Builder().add("token", tokenToRevoke).build()
                val req = Request.Builder()
                    .url("https://oauth2.googleapis.com/revoke")
                    .post(form)
                    .build()
                httpClient.newCall(req).execute().close()
            }
        }
        tokenStorage.clearAll()
    }

    private suspend fun exchangeToken(
        tokenRequest: TokenRequest,
        fallbackRefreshToken: String? = null,
        existingScopes: Set<String> = emptySet()
    ): Result<StoredTokenBundle> = suspendCancellableCoroutine { cont ->
        authService.performTokenRequest(tokenRequest) { tokenResponse, ex ->
            if (ex != null || tokenResponse == null || tokenResponse.accessToken.isNullOrBlank()) {
                val message = ex?.errorDescription ?: "Token exchange failed"
                cont.resume(Result.failure(IllegalStateException(message)))
                return@performTokenRequest
            }

            val scopes = tokenResponse.scopeSet ?: existingScopes
            val bundle = StoredTokenBundle(
                accessToken = tokenResponse.accessToken!!,
                refreshToken = tokenResponse.refreshToken ?: fallbackRefreshToken,
                expiresAtMillis = tokenResponse.accessTokenExpirationTime
                    ?: (System.currentTimeMillis() + 3_500_000L),
                grantedScopes = scopes
            )
            tokenStorage.saveTokens(bundle)
            cont.resume(Result.success(bundle))
        }
    }

    fun dispose() {
        authService.dispose()
    }
}
