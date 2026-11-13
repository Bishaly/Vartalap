package com.nextgen.vartalap.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.nextgen.vartalap.presentation.VartalapViewModel
import com.nextgen.vartalap.presentation.chat.ChatScreen
import com.nextgen.vartalap.presentation.compose.NewConversationScreen
import com.nextgen.vartalap.presentation.inbox.InboxScreen
import com.nextgen.vartalap.presentation.settings.SettingsScreen
import com.nextgen.vartalap.presentation.welcome.WelcomeScreen

object Routes {
    const val WELCOME = "welcome"
    const val INBOX = "inbox"
    const val SETTINGS = "settings"
    const val NEW_CONVERSATION = "new_conversation"
    const val CHAT = "chat/{threadId}"

    fun chatRoute(threadId: String): String = "chat/$threadId"
}

@Composable
fun VartalapNavGraph(
    viewModel: VartalapViewModel,
    initialThreadId: String?,
    onDeepLinkConsumed: () -> Unit
) {
    val navController = rememberNavController()
    val account by viewModel.activeAccount.collectAsStateWithLifecycle()

    LaunchedEffect(account, initialThreadId) {
        if (account != null && !initialThreadId.isNullOrBlank()) {
            navController.navigate(Routes.chatRoute(initialThreadId))
            onDeepLinkConsumed()
        }
    }

    val startDestination = if (account == null) Routes.WELCOME else Routes.INBOX

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Routes.WELCOME) {
            WelcomeScreen(
                viewModel = viewModel,
                onAuthenticated = {
                    navController.navigate(Routes.INBOX) {
                        popUpTo(Routes.WELCOME) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.INBOX) {
            InboxScreen(
                viewModel = viewModel,
                onOpenThread = { threadId ->
                    navController.navigate(Routes.chatRoute(threadId))
                },
                onOpenNewConversation = {
                    navController.navigate(Routes.NEW_CONVERSATION)
                },
                onOpenSettings = {
                    navController.navigate(Routes.SETTINGS)
                }
            )
        }

        composable(
            route = Routes.CHAT,
            arguments = listOf(navArgument("threadId") { type = NavType.StringType })
        ) { backStackEntry ->
            val threadId = backStackEntry.arguments?.getString("threadId") ?: return@composable
            ChatScreen(
                threadId = threadId,
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Routes.NEW_CONVERSATION) {
            NewConversationScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onCreated = { threadId ->
                    navController.navigate(Routes.chatRoute(threadId)) {
                        popUpTo(Routes.NEW_CONVERSATION) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onLoggedOut = {
                    navController.navigate(Routes.WELCOME) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}
