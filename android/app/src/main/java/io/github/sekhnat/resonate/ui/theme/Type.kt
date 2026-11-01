package io.github.sekhnat.resonate.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Nocturne's type scale for Android, all in Inter. Headings are weight 500 and tightened; body is 400.
 * Read it through `ResonateTheme.typography`. Stock Material components get the same styles through
 * [toMaterialTypography].
 */
@Immutable
data class ResonateTypography(
    /** Onboarding and empty-library heroes only. Nocturne's h1. */
    val display: TextStyle,
    /** A show's title on its page. Nocturne's h2. */
    val headlineLg: TextStyle,
    /** Large top-app-bar titles at the top of a tab, before the bar collapses. */
    val headlineMd: TextStyle,
    /** Collapsed top-app-bar titles, dialog titles, the Now playing episode title. */
    val titleLg: TextStyle,
    /** Card and bottom-sheet titles. */
    val titleMd: TextStyle,
    /** Transcript lines and episode notes read at length. */
    val bodyLg: TextStyle,
    /** Default body copy and settings labels. Nocturne's body, 15/1.55. */
    val bodyMd: TextStyle,
    /** Episode and show titles in lists, two lines at most. */
    val itemTitle: TextStyle,
    /** Show descriptions, dialog body, long settings hints. */
    val bodySm: TextStyle,
    /** Buttons and mini-player titles. */
    val labelLg: TextStyle,
    /** Row meta lines, chip text; bottom-nav labels at weight 500. */
    val labelMd: TextStyle,
    /** Tags and badges only. 11sp is the smallest text in the app. */
    val labelSm: TextStyle,
    /**
     * Section labels in lists and sheets. Compose has no text transform, so call `.uppercase()` on
     * the string where it is drawn; keep the string itself in sentence case.
     */
    val overline: TextStyle,
    /** Elapsed and remaining time, chapter times, sizes and speeds, with tabular numbers. */
    val time: TextStyle,
    /** Folder paths and server addresses shown as values in settings. */
    val mono: TextStyle,
)

private val Centered = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

private fun style(
    size: Float,
    lineHeight: Float,
    weight: Int,
    tracking: Float = 0f,
    family: FontFamily = InterFamily,
    features: String? = null,
) = TextStyle(
    fontFamily = family,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    fontWeight = FontWeight(weight),
    letterSpacing = if (tracking == 0f) TextUnit.Unspecified else tracking.em,
    fontFeatureSettings = features,
    lineHeightStyle = Centered,
)

internal val DefaultTypography = ResonateTypography(
    display = style(42f, 47f, 500, -0.015f),
    headlineLg = style(32f, 36f, 500, -0.015f),
    headlineMd = style(26f, 30f, 500, -0.02f),
    titleLg = style(20f, 24f, 500, -0.015f),
    titleMd = style(17f, 21f, 500),
    bodyLg = style(16f, 25f, 400),
    bodyMd = style(15f, 23f, 400),
    itemTitle = style(15f, 20f, 500),
    bodySm = style(13f, 20f, 400),
    labelLg = style(14f, 17f, 500),
    labelMd = style(12f, 16f, 400),
    labelSm = style(11f, 14f, 500, 0.02f),
    overline = style(11f, 14f, 500, 0.1f),
    time = style(12f, 16f, 400, features = "tnum"),
    mono = style(12.5f, 18f, 400, family = FontFamily.Monospace),
)

/** Material's slots filled from Nocturne's scale, so stock components match. */
internal fun ResonateTypography.toMaterialTypography() = Typography(
    displayLarge = display,
    displayMedium = display,
    displaySmall = headlineLg,
    headlineLarge = headlineLg,
    headlineMedium = headlineMd,
    headlineSmall = titleLg,
    titleLarge = titleLg,
    titleMedium = titleMd,
    titleSmall = itemTitle,
    bodyLarge = bodyLg,
    bodyMedium = bodyMd,
    bodySmall = bodySm,
    labelLarge = labelLg,
    labelMedium = labelMd,
    labelSmall = labelSm,
)
