package com.nextgen.vartalap

import android.app.Application
import com.nextgen.vartalap.authentication.GoogleOAuthManager
import com.nextgen.vartalap.data.InMemorySessionStore
import com.nextgen.vartalap.data.VartalapRepositoryImpl
import com.nextgen.vartalap.domain.VartalapRepository
import com.nextgen.vartalap.drive.GoogleDriveApiService
import com.nextgen.vartalap.drive.GoogleDriveNetworkClient
import com.nextgen.vartalap.gmail.GmailNetworkClient
import com.nextgen.vartalap.gmail.GmailQuotaGuard
import com.nextgen.vartalap.notifications.VartalapNotificationManager
import com.nextgen.vartalap.preferences.AppPreferencesStore
import com.nextgen.vartalap.security.KeystoreCryptoManager
import com.nextgen.vartalap.security.SecureTokenStorage
import com.nextgen.vartalap.utils.ConnectivityObserver
import okhttp3.OkHttpClient

class AppContainer(application: Application) {
    val prefsStore: AppPreferencesStore = AppPreferencesStore(application)
    val sessionStore: InMemorySessionStore = InMemorySessionStore()
    val cryptoManager: KeystoreCryptoManager = KeystoreCryptoManager()
    val tokenStorage: SecureTokenStorage = SecureTokenStorage(application, cryptoManager)
    val baseHttpClient: OkHttpClient = OkHttpClient()
    val oauthManager: GoogleOAuthManager = GoogleOAuthManager(application, tokenStorage, baseHttpClient)
    val quotaGuard: GmailQuotaGuard = GmailQuotaGuard()
    val gmailHttpClient: OkHttpClient = GmailNetworkClient.createOkHttpClient(oauthManager, quotaGuard)
    val gmailApiService = GmailNetworkClient.createApiService(gmailHttpClient)
    val driveApiService: GoogleDriveApiService = GoogleDriveNetworkClient.createApiService(oauthManager)
    val connectivityObserver: ConnectivityObserver = ConnectivityObserver(application)
    val notificationManager: VartalapNotificationManager = VartalapNotificationManager(application)

    val repository: VartalapRepository = VartalapRepositoryImpl(
        context = application,
        sessionStore = sessionStore,
        prefsStore = prefsStore,
        gmailApi = gmailApiService,
        driveApi = driveApiService,
        oauthManager = oauthManager,
        connectivityObserver = connectivityObserver,
        quotaGuard = quotaGuard
    )
}

class VartalapApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.notificationManager.createChannels()
    }
}
