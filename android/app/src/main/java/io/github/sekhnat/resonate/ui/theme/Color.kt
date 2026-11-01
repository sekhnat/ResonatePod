package io.github.sekhnat.resonate.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

// Colours of the ResonatePod Android design system (Nocturne). Dark is the desktop app's
// src/styles/nocturne.css exactly; light is built from the same ramps. Change a value in the
// design system first, then here.

/**
 * Nocturne's tonal ramps, generated in OKLCH on one shared lightness scale. They are the same in
 * both themes. UI code reads the roles in [ResonateColors], which pick ramp steps per theme.
 * The section colours are marketing grounds (Play Store art, onboarding), not interface colours.
 */
object NocturneRamp {
    val Neutral100 = Color(0xFFF3F5FE)
    val Neutral200 = Color(0xFFE4E7F5)
    val Neutral300 = Color(0xFFCFD3E5)
    val Neutral400 = Color(0xFFB2B6CA)
    val Neutral500 = Color(0xFF9397AB)
    val Neutral600 = Color(0xFF75798C)
    val Neutral700 = Color(0xFF595D6C)
    val Neutral800 = Color(0xFF3F424D)
    val Neutral900 = Color(0xFF292B31)
    val Accent100 = Color(0xFFF5F4FF)
    val Accent200 = Color(0xFFE7E5FE)
    val Accent300 = Color(0xFFD2CEFD)
    val Accent400 = Color(0xFFB5ABFC)
    val Accent500 = Color(0xFF968AE0)
    val Accent600 = Color(0xFF796CBF)
    val Accent700 = Color(0xFF5D5294)
    val Accent800 = Color(0xFF423A6A)
    val Accent900 = Color(0xFF2B2741)
    val Accent2_100 = Color(0xFFF5F4FF)
    val Accent2_200 = Color(0xFFE7E5FE)
    val Accent2_300 = Color(0xFFD2CEFD)
    val Accent2_400 = Color(0xFFB5AFE8)
    val Accent2_500 = Color(0xFF9690C9)
    val Accent2_600 = Color(0xFF7972A9)
    val Accent2_700 = Color(0xFF5C5783)
    val Accent2_800 = Color(0xFF423E5D)
    val Accent2_900 = Color(0xFF2B293A)
    val Section = Color(0xFF262A60)
    val SectionGlow = Color(0xFF353B80)
    val SectionGhost = Color(0xFF4C5397)
}

/** The colour roles. Read them through `ResonateTheme.colors`; never use a ramp step for UI directly. */
@Immutable
data class ResonateColors(
    /** Screen ground behind every list, page and player. Nocturne's own ground in dark; neutral-100 in light. */
    val bg: Color,
    /** Cards, settings groups, download cards, the mini player, dialogs and bottom sheets. */
    val surface: Color,
    /** Bottom navigation bar and a scrolled top app bar. Dark is the desktop sidebar's mix: surface at 45% over bg. */
    val surfaceNav: Color,
    /** Recessed grounds: the storage bar, empty artwork wells, neutral tags. */
    val surfaceSunken: Color,
    /** Primary text and icons on bg, surface and surface-nav (dark 14.5:1 on bg; light 16.2:1). */
    val text: Color,
    /** Show names, durations, player times, inactive nav labels and icons, on bg and surface (dark 7.6:1 on surface; light 9.2:1 on bg). */
    val textSecondary: Color,
    /** Row meta, played titles, section labels, past chapters and inactive transcript lines, on bg and surface (dark 5.3:1 on surface; light 6.0:1 on bg). */
    val textTertiary: Color,
    /** The Nocturne blurple: outlined primary buttons, links, the seek fill, the new-episode dot, focus rings. Text-safe on bg and surface (dark 4.7:1 on surface; light 6.2:1 on bg). */
    val accent: Color,
    /** Text and icons on a filled color-accent, such as the hero play button (dark 5.5:1; light 6.8:1). */
    val onAccent: Color,
    /** The machine-derived second accent, a quieter blurple; secondary tags only. */
    val accent2: Color,
    /** Accent text on tinted grounds: the playing episode's title, the current chapter, a failed download's status (11.6:1 on accent-soft in dark; 8.3:1 in light). */
    val accentStrong: Color,
    /** Selected fills: the bottom-nav indicator, selected chips and segments, accent tags. */
    val accentContainer: Color,
    /** Text and icons on accent-container (dark 9.4:1; light 6.8:1). */
    val onAccentContainer: Color,
    /** The quiet highlight behind the playing episode row and current chapter. */
    val accentSoft: Color,
    /** Hairline rules between rows and around the nav bar. Decorative only (about 1.5:1); never the sole edge of a control. Dark is Nocturne's text at 16%. */
    val divider: Color,
    /** Edges of controls: text fields, secondary buttons, unselected chips, the switch track, row play buttons. At least 3:1 on bg and surface in both themes. */
    val outline: Color,
    /** The unfilled part of the seek bar, row progress and download bars. color-accent reads on it at 3.1:1 (dark) and 4.6:1 (light). */
    val track: Color,
    /** The knob of a switch that is off, on color-track (dark 5.0:1; light 4.4:1). */
    val switchKnob: Color,
    /** Behind dialogs and bottom sheets: Nocturne ink at 60% (dark) or 40% (light). */
    val scrim: Color,
    /** Focus ring for keyboard, D-pad and switch access: 2dp solid, offset 2dp. */
    val focus: Color,
    /** Monogram letters on placeholder artwork, whose gradient is always dark in both themes. */
    val artInk: Color,
)

internal val DarkColors = ResonateColors(
    bg = Color(0xFF161826),
    surface = Color(0xFF232532),
    surfaceNav = Color(0xFF1C1E2B),
    surfaceSunken = NocturneRamp.Neutral900,
    text = Color(0xFFE9E9ED),
    textSecondary = NocturneRamp.Neutral400,
    textTertiary = NocturneRamp.Neutral500,
    accent = Color(0xFF9184D9),
    onAccent = Color(0xFF161826),
    accent2 = Color(0xFFA7A1DB),
    accentStrong = NocturneRamp.Accent200,
    accentContainer = NocturneRamp.Accent800,
    onAccentContainer = NocturneRamp.Accent100,
    accentSoft = NocturneRamp.Accent900,
    divider = Color(0x29E9E9ED),
    outline = NocturneRamp.Neutral600,
    track = NocturneRamp.Neutral800,
    switchKnob = NocturneRamp.Neutral400,
    scrim = Color(0x99161826),
    focus = Color(0xFF9184D9), // same as accent
    artInk = NocturneRamp.Neutral100,
)

internal val LightColors = ResonateColors(
    bg = NocturneRamp.Neutral100,
    surface = Color(0xFFFFFFFF),
    surfaceNav = Color(0xFFFFFFFF),
    surfaceSunken = NocturneRamp.Neutral200,
    text = Color(0xFF161826),
    textSecondary = NocturneRamp.Neutral800,
    textTertiary = NocturneRamp.Neutral700,
    accent = NocturneRamp.Accent700,
    onAccent = Color(0xFFFFFFFF),
    accent2 = NocturneRamp.Accent2_700,
    accentStrong = NocturneRamp.Accent800,
    accentContainer = NocturneRamp.Accent300,
    onAccentContainer = NocturneRamp.Accent800,
    accentSoft = NocturneRamp.Accent200,
    divider = Color(0x29161826),
    outline = NocturneRamp.Neutral600,
    track = NocturneRamp.Neutral300,
    switchKnob = NocturneRamp.Neutral700,
    scrim = Color(0x66161826),
    focus = Color(0xFF5D5294), // same as accent
    artInk = NocturneRamp.Neutral100,
)
