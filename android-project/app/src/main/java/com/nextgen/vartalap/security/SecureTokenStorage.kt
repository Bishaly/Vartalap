package com.nextgen.vartalap.security

import android.content.Context
import android.content.SharedPreferences

data class StoredTokenBundle(
    val accessToken: String,
    val refreshToken: String?,
    val expiresAtMillis: Long,
    val grantedScopes: Set<String>
)

class SecureTokenStorage(
    context: Context,
    private val cryptoManager: KeystoreCryptoManager
) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun saveTokens(bundle: StoredTokenBundle) {
        val serialized = listOf(
            bundle.accessToken,
            bundle.refreshToken.orEmpty(),
            bundle.expiresAtMillis.toString(),
            bundle.grantedScopes.joinToString(",")
        ).joinToString(FIELD_SEPARATOR)

        val encrypted = cryptoManager.encrypt(serialized)
        prefs.edit().putString(KEY_TOKEN_BLOB, encrypted).apply()
    }

    @Synchronized
    fun loadTokens(): StoredTokenBundle? {
        val encrypted = prefs.getString(KEY_TOKEN_BLOB, null) ?: return null
        val decrypted = cryptoManager.decrypt(encrypted) ?: return null
        val parts = decrypted.split(FIELD_SEPARATOR)
        if (parts.size < 4 || parts[0].isBlank()) return null

        val scopes = parts[3]
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toSet()

        return StoredTokenBundle(
            accessToken = parts[0],
            refreshToken = parts[1].ifBlank { null },
            expiresAtMillis = parts[2].toLongOrNull() ?: 0L,
            grantedScopes = scopes
        )
    }

    @Synchronized
    fun clearAll() {
        prefs.edit().clear().apply()
        cryptoManager.deleteKey()
    }

    companion object {
        private const val PREFS_NAME = "vartalap_secure_tokens_v1"
        private const val KEY_TOKEN_BLOB = "encrypted_oauth_bundle"
        private const val FIELD_SEPARATOR = "\u001F"
    }
}
