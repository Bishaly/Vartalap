package com.nextgen.vartalap.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.nextgen.vartalap.domain.ThemeMode

// Official Vartalap Palette
val DeepForest = Color(0xFF183B38)
val JadeGreen = Color(0xFF237D68)
val MintMist = Color(0xFFDCEBE2)
val SoftIvory = Color(0xFFF5F7F4)
val WarmGold = Color(0xFFD8B982)
val SlateBlue = Color(0xFF293D50)
val Charcoal = Color(0xFF252D2B)

private val ForestMintColors = lightColorScheme(
    primary = DeepForest,
    onPrimary = Color.White,
    primaryContainer = MintMist,
    onPrimaryContainer = DeepForest,
    secondary = JadeGreen,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE7F2EC),
    onSecondaryContainer = DeepForest,
    tertiary = WarmGold,
    onTertiary = Charcoal,
    background = SoftIvory,
    onBackground = Charcoal,
    surface = Color.White,
    onSurface = Charcoal,
    surfaceVariant = MintMist.copy(alpha = 0.55f),
    onSurfaceVariant = SlateBlue,
    outline = Color(0xFFC8D8D0)
)

private val SoftIvoryColors = lightColorScheme(
    primary = JadeGreen,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEDF4EF),
    onPrimaryContainer = DeepForest,
    secondary = SlateBlue,
    onSecondary = Color.White,
    tertiary = WarmGold,
    onTertiary = Charcoal,
    background = SoftIvory,
    onBackground = Charcoal,
    surface = Color(0xFFFCFDFB),
    onSurface = Charcoal,
    surfaceVariant = Color(0xFFEBEEE9),
    onSurfaceVariant = SlateBlue,
    outline = Color(0xFFDADFD8)
)

private val MidnightJadeColors = darkColorScheme(
    primary = JadeGreen,
    onPrimary = Color.White,
    primaryContainer = DeepForest,
    onPrimaryContainer = MintMist,
    secondary = MintMist,
    onSecondary = DeepForest,
    tertiary = WarmGold,
    onTertiary = Charcoal,
    background = Color(0xFF171D1B),
    onBackground = SoftIvory,
    surface = Charcoal,
    onSurface = SoftIvory,
    surfaceVariant = Color(0xFF2E3835),
    onSurfaceVariant = MintMist.copy(alpha = 0.85f),
    outline = Color(0xFF3E4A46)
)

data class VartalapBubblePalette(
    val incomingContainer: Color,
    val incomingText: Color,
    val outgoingContainer: Color,
    val outgoingText: Color
)

fun bubblePaletteFor(themeMode: ThemeMode): VartalapBubblePalette {
    return when (themeMode) {
        ThemeMode.FOREST_MINT -> VartalapBubblePalette(
            incomingContainer = Color.White,
            incomingText = Charcoal,
            outgoingContainer = JadeGreen,
            outgoingText = Color.White
        )
        ThemeMode.SOFT_IVORY -> VartalapBubblePalette(
            incomingContainer = Color.White,
            incomingText = Charcoal,
            outgoingContainer = DeepForest,
            outgoingText = Color.White
        )
        ThemeMode.MIDNIGHT_JADE -> VartalapBubblePalette(
            incomingContainer = Color(0xFF2B3532),
            incomingText = SoftIvory,
            outgoingContainer = JadeGreen,
            outgoingText = Color.White
        )
    }
}

@Composable
fun VartalapTheme(
    themeMode: ThemeMode,
    content: @Composable () -> Unit
) {
    val scheme = when (themeMode) {
        ThemeMode.FOREST_MINT -> ForestMintColors
        ThemeMode.SOFT_IVORY -> SoftIvoryColors
        ThemeMode.MIDNIGHT_JADE -> MidnightJadeColors
    }

    MaterialTheme(
        colorScheme = scheme,
        typography = Typography(),
        content = content
    )
}
