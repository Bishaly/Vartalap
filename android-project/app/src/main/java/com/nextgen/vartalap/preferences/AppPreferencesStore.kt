package com.nextgen.vartalap.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.nextgen.vartalap.domain.AppSettings
import com.nextgen.vartalap.domain.ConversationCategory
import com.nextgen.vartalap.domain.ThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.vartalapPrefsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "vartalap_minimal_preferences"
)

class AppPreferencesStore(private val context: Context) {

    private object Keys {
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val NOTIFICATIONS_ENABLED = booleanPreferencesKey("notifications_enabled")
        val SYNC_INTERVAL_MINUTES = intPreferencesKey("sync_interval_minutes")
        val DRIVE_FEATURE_ENABLED = booleanPreferencesKey("drive_feature_enabled")
        val LAST_SYNC_TIMESTAMP = longPreferencesKey("last_sync_timestamp")
        val LAST_HISTORY_ID = stringPreferencesKey("last_history_id")
        val CATEGORY_OVERRIDES_JSON = stringPreferencesKey("category_overrides_json")
    }

    private val json = Json { ignoreUnknownKeys = true }

    fun observeSettings(cacheBytesProvider: () -> Long): Flow<AppSettings> {
        return context.vartalapPrefsDataStore.data.map { prefs ->
            val themeName = prefs[Keys.THEME_MODE] ?: ThemeMode.FOREST_MINT.name
            AppSettings(
                themeMode = runCatching { ThemeMode.valueOf(themeName) }
                    .getOrDefault(ThemeMode.FOREST_MINT),
                notificationsEnabled = prefs[Keys.NOTIFICATIONS_ENABLED] ?: true,
                syncIntervalMinutes = (prefs[Keys.SYNC_INTERVAL_MINUTES] ?: 15).coerceAtLeast(15),
                driveFeatureEnabled = prefs[Keys.DRIVE_FEATURE_ENABLED] ?: false,
                lastSyncTimestamp = prefs[Keys.LAST_SYNC_TIMESTAMP] ?: 0L,
                localCacheBytes = cacheBytesProvider()
            )
        }
    }

    fun observeCategoryOverrides(): Flow<Map<String, ConversationCategory>> {
        return context.vartalapPrefsDataStore.data.map { prefs ->
            decodeOverrides(prefs[Keys.CATEGORY_OVERRIDES_JSON])
        }
    }

    suspend fun getCategoryOverrides(): Map<String, ConversationCategory> {
        val raw = context.vartalapPrefsDataStore.data.first()[Keys.CATEGORY_OVERRIDES_JSON]
        return decodeOverrides(raw)
    }

    suspend fun setThreadCategoryOverride(threadId: String, category: ConversationCategory) {
        context.vartalapPrefsDataStore.edit { prefs ->
            val current = decodeOverrides(prefs[Keys.CATEGORY_OVERRIDES_JSON]).toMutableMap()
            current[threadId] = category
            val serialized = json.encodeToString(current.mapValues { it.value.name })
            prefs[Keys.CATEGORY_OVERRIDES_JSON] = serialized
        }
    }

    suspend fun getLastHistoryId(): String? {
        return context.vartalapPrefsDataStore.data.first()[Keys.LAST_HISTORY_ID]
    }

    suspend fun setSyncCheckpoint(historyId: String?, timestampMillis: Long) {
        context.vartalapPrefsDataStore.edit { prefs ->
            if (!historyId.isNullOrBlank()) {
                prefs[Keys.LAST_HISTORY_ID] = historyId
            } else {
                prefs.remove(Keys.LAST_HISTORY_ID)
            }
            prefs[Keys.LAST_SYNC_TIMESTAMP] = timestampMillis
        }
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.vartalapPrefsDataStore.edit { it[Keys.THEME_MODE] = mode.name }
    }

    suspend fun setNotificationsEnabled(enabled: Boolean) {
        context.vartalapPrefsDataStore.edit { it[Keys.NOTIFICATIONS_ENABLED] = enabled }
    }

    suspend fun setSyncIntervalMinutes(minutes: Int) {
        context.vartalapPrefsDataStore.edit {
            it[Keys.SYNC_INTERVAL_MINUTES] = minutes.coerceAtLeast(15)
        }
    }

    suspend fun setDriveFeatureEnabled(enabled: Boolean) {
        context.vartalapPrefsDataStore.edit { it[Keys.DRIVE_FEATURE_ENABLED] = enabled }
    }

    suspend fun clearSyncCheckpointAndDriveToggle() {
        context.vartalapPrefsDataStore.edit { prefs ->
            prefs.remove(Keys.LAST_HISTORY_ID)
            prefs.remove(Keys.LAST_SYNC_TIMESTAMP)
            prefs.remove(Keys.CATEGORY_OVERRIDES_JSON)
            prefs[Keys.DRIVE_FEATURE_ENABLED] = false
        }
    }

    private fun decodeOverrides(raw: String?): Map<String, ConversationCategory> {
        if (raw.isNullOrBlank()) return emptyMap()
        return runCatching {
            val map = json.decodeFromString<Map<String, String>>(raw)
            map.mapNotNull { (k, v) ->
                runCatching { k to ConversationCategory.valueOf(v) }.getOrNull()
            }.toMap()
        }.getOrDefault(emptyMap())
    }
}
