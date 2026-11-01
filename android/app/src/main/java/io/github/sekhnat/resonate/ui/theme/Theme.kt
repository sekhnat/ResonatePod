package io.github.sekhnat.resonate.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf

/** The Preferences choice: follow the system (the default), or keep one theme. */
enum class ThemeMode { System, Dark, Light }

private val LocalColors = staticCompositionLocalOf { DarkColors }
private val LocalTypography = staticCompositionLocalOf { DefaultTypography }
private val LocalShapes = staticCompositionLocalOf { DefaultShapes }
private val LocalElevation = staticCompositionLocalOf { DarkElevation }
private val LocalIsDark = staticCompositionLocalOf { true }

/**
 * Resonate's theme: Nocturne in dark, its daylight counterpart in light. Wrap the app's content in
 * it once. Material You dynamic colour stays off, so the app keeps its own blurple.
 */
@Composable
fun ResonateTheme(
    mode: ThemeMode = ThemeMode.System,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
    }
    val colors = if (dark) DarkColors else LightColors
    val colorScheme = remember(dark) { colors.toColorScheme(dark) }
    val materialTypography = remember { DefaultTypography.toMaterialTypography() }
    val materialShapes = remember { DefaultShapes.toMaterialShapes() }
    CompositionLocalProvider(
        LocalColors provides colors,
        LocalTypography provides DefaultTypography,
        LocalShapes provides DefaultShapes,
        LocalElevation provides if (dark) DarkElevation else LightElevation,
        LocalIsDark provides dark,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = materialTypography,
            shapes = materialShapes,
        ) {
            CompositionLocalProvider(LocalContentColor provides colors.text, content = content)
        }
    }
}

/** The current theme's values, for use inside [ResonateTheme]. */
object ResonateTheme {
    val colors: ResonateColors
        @Composable @ReadOnlyComposable get() = LocalColors.current
    val typography: ResonateTypography
        @Composable @ReadOnlyComposable get() = LocalTypography.current
    val shapes: ResonateShapes
        @Composable @ReadOnlyComposable get() = LocalShapes.current
    val elevation: ResonateElevation
        @Composable @ReadOnlyComposable get() = LocalElevation.current
    /** Whether the dark theme is showing, for system-bar icon colours and artwork choices. */
    val isDark: Boolean
        @Composable @ReadOnlyComposable get() = LocalIsDark.current
    val spacing = ResonateSpacing
    val size = ResonateSize
}

/**
 * Material's colour slots filled from Nocturne's roles, so stock components inherit them. Nocturne
 * has no red: Material's error slots take the accent's strong and container tones, and a failure is
 * told in words, not colour alone.
 */
internal fun ResonateColors.toColorScheme(dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = accentContainer,
        onPrimaryContainer = onAccentContainer,
        inversePrimary = accentStrong,
        secondary = accent2,
        onSecondary = onAccent,
        secondaryContainer = accentContainer,
        onSecondaryContainer = onAccentContainer,
        tertiary = accent2,
        onTertiary = onAccent,
        tertiaryContainer = accentSoft,
        onTertiaryContainer = accentStrong,
        background = bg,
        onBackground = text,
        surface = bg,
        onSurface = text,
        surfaceVariant = surfaceSunken,
        onSurfaceVariant = textSecondary,
        surfaceTint = accent,
        inverseSurface = text,
        inverseOnSurface = bg,
        error = accentStrong,
        onError = bg,
        errorContainer = accentContainer,
        onErrorContainer = onAccentContainer,
        outline = outline,
        outlineVariant = divider,
        scrim = scrim,
        surfaceBright = surface,
        surfaceDim = bg,
        surfaceContainerLowest = surfaceSunken,
        surfaceContainerLow = surfaceNav,
        surfaceContainer = surfaceNav,
        surfaceContainerHigh = surface,
        surfaceContainerHighest = surface,
    )
}
