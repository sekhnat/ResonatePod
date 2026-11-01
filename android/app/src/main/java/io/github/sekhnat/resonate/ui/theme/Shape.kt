package io.github.sekhnat.resonate.ui.theme

import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.dp

/** Nocturne's corner radii. Read them through `ResonateTheme.shapes`. */
@Immutable
data class ResonateShapes(
    /** Source tags, keyboard hints, small badges (4dp). */
    val sm: CornerBasedShape = RoundedCornerShape(4.dp),
    /** Buttons, text fields, cards, settings groups, segmented buttons (8dp). */
    val md: CornerBasedShape = RoundedCornerShape(8.dp),
    /** Dialogs, the mini player, Now playing artwork (14dp). */
    val lg: CornerBasedShape = RoundedCornerShape(14.dp),
    /** Bottom sheets: 28dp on the top corners only. */
    val sheet: CornerBasedShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    /** Chips, the bottom-nav indicator, play buttons, the switch. */
    val full: CornerBasedShape = RoundedCornerShape(percent = 50),
    /** Episode artwork in rows: desktop's 6dp. Grid tiles use [md]. */
    val art: CornerBasedShape = RoundedCornerShape(6.dp),
)

internal val DefaultShapes = ResonateShapes()

/**
 * Material's slots filled from Nocturne's radii. Material's dialogs use extraLarge (28dp), while
 * Nocturne's dialogs are [ResonateShapes.lg]: pass `shape = ResonateTheme.shapes.lg` to them.
 */
internal fun ResonateShapes.toMaterialShapes() = Shapes(
    extraSmall = sm,
    small = md,
    medium = md,
    large = lg,
    extraLarge = RoundedCornerShape(28.dp),
)
