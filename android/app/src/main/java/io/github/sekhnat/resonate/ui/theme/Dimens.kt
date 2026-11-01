package io.github.sekhnat.resonate.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Nocturne's spacing runs in steps of 2.8, kept exact from the desktop app. The screen gutter is
 * [space6]; sections are [space8] apart.
 */
object ResonateSpacing {
    /** Gaps inside a text stack (title to meta). */
    val space1 = 2.8.dp
    /** Icon-to-label gaps, tag rows, the gap between chips. */
    val space2 = 5.6.dp
    /** Between controls in a row; card inner gaps. */
    val space3 = 8.4.dp
    /** Art-to-text in rows; card padding. */
    val space4 = 11.2.dp
    /** The screen gutter: list rows and app bars inset by this on both sides. */
    val space6 = 16.8.dp
    /** Between sections of a screen; dialog padding. */
    val space8 = 22.4.dp
    val gutter = space6
}

/** Fixed dimensions for touch, added for Android. */
object ResonateSize {
    /** The minimum touch target for anything tappable, even when what is drawn is smaller. */
    val touch = 48.dp
    /** Icons inside row play buttons and tags. */
    val iconSm = 16.dp
    /** Icons in rows, menus and the mini player. */
    val iconMd = 20.dp
    /** App-bar, bottom-nav and player-control icons. */
    val iconLg = 24.dp
    val topBar = 64.dp
    val bottomNav = 80.dp
    /** The mini player, docked above the bottom nav. */
    val miniPlayer = 64.dp
    /** Artwork in episode rows. */
    val rowArt = 48.dp
    /** The round play button on rows (inside a 48dp target). */
    val playRow = 40.dp
    /** The filled play button on Now playing. */
    val playHero = 72.dp
    /** The width and offset of the focus ring. */
    val focusRing = 2.dp
}

/** Alpha for disabled buttons and controls, as on desktop. */
const val DisabledAlpha = 0.45f

/** Durations in milliseconds. Cut to the end state when the system asks to reduce motion. */
object ResonateMotion {
    /** Fades, such as row actions appearing. */
    const val FADE = 120
    /** A switch knob sliding. */
    const val SWITCH = 150
    /** A snackbar rising in, with an ease-out curve. */
    const val SNACKBAR = 180
    /** The transcript's current line changing colour; download bars moving (linear). */
    const val FOLLOW = 300
    /** One turn of the downloading spinner (linear, repeating). */
    const val SPIN = 1000
}
