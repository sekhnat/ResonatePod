package io.github.sekhnat.resonate.ui.theme

import androidx.compose.foundation.border
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * One elevation step: a 1dp edge plus a shadow. Compose shadows are Android's elevation shadows,
 * not CSS blurs, so these approximate the design system's `shadow-*` tokens. Shadow colours take
 * effect on API 28 and up.
 */
@Immutable
data class ElevationLevel(
    val edge: Color,
    val shadow: Dp,
    val shadowColor: Color,
)

/**
 * In dark, elevation is a hairline edge plus ambient darkness, as on desktop. In light, it is a soft
 * ink-tinted shadow. Read it through `ResonateTheme.elevation`.
 */
@Immutable
data class ResonateElevation(
    /** Resting cards that need an edge. */
    val sm: ElevationLevel,
    /** The mini player, artwork, snackbars. */
    val md: ElevationLevel,
    /** Dialogs and bottom sheets. */
    val lg: ElevationLevel,
)

private val Ink = Color(0xFF161826)

internal val DarkElevation = ResonateElevation(
    sm = ElevationLevel(edge = NocturneRamp.Neutral800, shadow = 0.dp, shadowColor = Color.Transparent),
    md = ElevationLevel(edge = NocturneRamp.Neutral700, shadow = 6.dp, shadowColor = Color.Black.copy(alpha = 0.55f)),
    lg = ElevationLevel(edge = NocturneRamp.Neutral500, shadow = 16.dp, shadowColor = Color.Black.copy(alpha = 0.65f)),
)

internal val LightElevation = ResonateElevation(
    sm = ElevationLevel(edge = NocturneRamp.Neutral200, shadow = 0.dp, shadowColor = Color.Transparent),
    md = ElevationLevel(edge = Color.Transparent, shadow = 6.dp, shadowColor = Ink.copy(alpha = 0.12f)),
    lg = ElevationLevel(edge = Ink.copy(alpha = 0.06f), shadow = 16.dp, shadowColor = Ink.copy(alpha = 0.18f)),
)

/** Draws [level]'s shadow and edge around [shape]. Apply it before the background. */
fun Modifier.nocturneElevation(level: ElevationLevel, shape: Shape): Modifier {
    val shadowed = if (level.shadow > 0.dp) {
        shadow(level.shadow, shape, clip = false, ambientColor = level.shadowColor, spotColor = level.shadowColor)
    } else {
        this
    }
    return if (level.edge.alpha > 0f) shadowed.border(1.dp, level.edge, shape) else shadowed
}
