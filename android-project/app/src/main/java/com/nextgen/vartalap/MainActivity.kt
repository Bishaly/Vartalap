package com.nextgen.vartalap

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nextgen.vartalap.navigation.VartalapNavGraph
import com.nextgen.vartalap.presentation.VartalapViewModel
import com.nextgen.vartalap.presentation.VartalapViewModelFactory
import com.nextgen.vartalap.presentation.theme.VartalapTheme

class MainActivity : ComponentActivity() {

    private var deepLinkThreadId by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        deepLinkThreadId = extractThreadId(intent)

        val app = application as VartalapApp
        val factory = VartalapViewModelFactory(app)

        setContent {
            val viewModel: VartalapViewModel = viewModel(factory = factory)
            val settings by viewModel.settings.collectAsStateWithLifecycle()

            VartalapTheme(themeMode = settings.themeMode) {
                VartalapNavGraph(
                    viewModel = viewModel,
                    initialThreadId = deepLinkThreadId,
                    onDeepLinkConsumed = { deepLinkThreadId = null }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        deepLinkThreadId = extractThreadId(intent)
    }

    private fun extractThreadId(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (data.scheme == "vartalap" && data.host == "thread") {
            return data.lastPathSegment
        }
        return null
    }
}
