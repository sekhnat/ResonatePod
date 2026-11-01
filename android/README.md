# Resonate for Android

The Android app is starting here. So far this folder holds only its **Jetpack Compose theme**, built
from the ResonatePod Android design system: Nocturne, the desktop app's design system, carried to
phones and given a light theme made from the same colour ramps. There is no Gradle build yet. The
files sit where a single-module app keeps them, ready for the app module to be created around them.

```
app/src/main/java/io/github/sekhnat/resonate/ui/theme/
  Theme.kt      ResonateTheme { } and ThemeMode (System, Dark, Light); ResonateTheme.colors, .typography,
                .shapes, .elevation, .spacing, .size; the mapping onto Material 3's colour scheme
  Color.kt      NocturneRamp (the tonal ramps) and ResonateColors (the roles), dark and light
  Type.kt       ResonateTypography (15 styles in Inter) and its mapping onto Material's slots
  Shape.kt      ResonateShapes (4, 8, 14, 28 sheet tops, full, 6 for row art)
  Dimens.kt     ResonateSpacing (Nocturne's 2.8 steps), ResonateSize (48dp targets and fixed sizes),
                DisabledAlpha, ResonateMotion
  Elevation.kt  ResonateElevation and Modifier.nocturneElevation(level, shape)
  Font.kt       Inter from res/font; the only file that touches Android resources
app/src/main/res/font/inter_variable.ttf   Inter 4.1, variable (license: third_party/Inter-OFL.txt)
```

## Wiring it into the app

- Give the app module the namespace `io.github.sekhnat.resonate` (the same app id as the desktop
  build). `Font.kt` imports `io.github.sekhnat.resonate.R`; change that import if the namespace differs.
- Use `minSdk` 26 or higher: the variable font's weight axis needs it.
- Depend on the Compose BOM and `androidx.compose.material3:material3`, `androidx.compose.ui:ui` and
  `androidx.compose.foundation:foundation`. The theme was written against BOM 2026.09.00.
- Wrap the content once, passing the Preferences choice:

  ```kotlin
  setContent {
      ResonateTheme(mode = themeModeFromPreferences) { App() }
  }
  ```

- Call `enableEdgeToEdge()` in the activity, and draw the status and navigation bars over
  `ResonateTheme.colors.bg`, with their icons following `ResonateTheme.isDark`.
- Leave Material You dynamic colour off. The theme never asks for it.

## Using it

- Read colours by role (`ResonateTheme.colors.textSecondary`, `.accentContainer`), never by ramp
  step. The roles pick different ramp steps in dark and light.
- Stock Material 3 components follow the theme through the colour, type and shape mapping. Two of
  Nocturne's looks need setting at the call site, because Material fixes these shapes itself:
  buttons are outlined in `accent` with `shapes.md` corners (Material's are filled pills), and chips
  are pills (`shapes.full`).
- Uppercase `overline` text with `.uppercase()` where it is drawn. Compose has no text transform.
- Nocturne has no red. Material's error slots get the accent's strong and container tones, so
  always state a failure in words as well.

## Checked so far

There is no Android SDK in the environment where these files were written. Every file except
`Font.kt` was compiled with Compose for Desktop (Kotlin 2.4.21, Compose Multiplatform 1.12.1,
Material 3 1.9.0) with warnings treated as errors, and rendered headless in both themes with
`Font.kt` replaced by a stub. `Font.kt` itself will first compile in the app's Android build.
