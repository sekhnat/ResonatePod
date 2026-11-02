# Resonate for Android

The Android app is starting here. So far it is a Gradle project with one app module that opens a
placeholder welcome screen, the launcher icon, and the **Jetpack Compose theme**. The theme is built
from the ResonatePod Android design system: Nocturne, the desktop app's design system, carried to
phones and given a light theme made from the same colour ramps.

## Building

You need JDK 17 or newer and the Android SDK with platform 37. Android Studio installs both; on the
command line, point `sdk.dir` in `local.properties` (not committed) at the SDK.

```bash
cd android && ./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`. `./gradlew lintDebug` runs Android lint.

| | |
| --- | --- |
| Application id, namespace | `io.github.sekhnat.resonate` (the same id as the desktop build) |
| minSdk | 26, the floor for the variable font's weight axis and for adaptive icons |
| compileSdk / targetSdk | 37 / 36. Compose needs 37 to compile against; targeting 37 waits until its behaviour changes are tested |
| Toolchain | Gradle 9.8.1 (wrapper), Android Gradle Plugin 9.4.1, Kotlin 2.4.21, Compose BOM 2026.09.00 |

Versions are pinned in `gradle/libs.versions.toml`.

## Layout

```
app/src/main/
  java/io/github/sekhnat/resonate/
    MainActivity.kt     Edge-to-edge activity; a placeholder WelcomeScreen with dark and light previews
    ui/theme/
      Theme.kt          ResonateTheme { } and ThemeMode (System, Dark, Light); ResonateTheme.colors,
                        .typography, .shapes, .elevation, .spacing, .size, .isDark; the Material 3 mapping
      Color.kt          NocturneRamp (the tonal ramps) and ResonateColors (the roles), dark and light
      Type.kt           ResonateTypography (15 styles in Inter) and its mapping onto Material's slots
      Shape.kt          ResonateShapes (4, 8, 14, 28 sheet tops, full, 6 for row art)
      Dimens.kt         ResonateSpacing (Nocturne's 2.8 steps), ResonateSize (48dp targets and fixed
                        sizes), DisabledAlpha, ResonateMotion
      Elevation.kt      ResonateElevation and Modifier.nocturneElevation(level, shape)
      Font.kt           Inter from res/font
  res/
    font/inter_variable.ttf      Inter 4.1, variable (license: third_party/Inter-OFL.txt)
    mipmap-anydpi/ic_launcher*   Adaptive icon: background, foreground and monochrome (themed icon)
    drawable/ic_launcher_*       The layers: the desktop icon's gradient, and its waveform path scaled
                                 into the 66dp safe zone
    values*/themes.xml           The window theme: Nocturne's ground behind Compose and at launch
```

## Using the theme

- `MainActivity` wraps everything in `ResonateTheme { }`, which follows the system setting. When the
  Preferences screen exists, pass its choice as `ResonateTheme(mode = …)`.
- Read colours by role (`ResonateTheme.colors.textSecondary`, `.accentContainer`), never by ramp
  step. The roles pick different ramp steps in dark and light.
- Stock Material 3 components follow the theme through the colour, type and shape mapping. Two of
  Nocturne's looks need setting at the call site, because Material fixes these shapes itself:
  buttons are outlined in `accent` with `shapes.md` corners (Material's are filled pills), and chips
  are pills (`shapes.full`).
- Uppercase `overline` text with `.uppercase()` where it is drawn. Compose has no text transform.
- Nocturne has no red. Material's error slots get the accent's strong and container tones, so
  always state a failure in words as well.
- Material You dynamic colour stays off. The theme never asks for it.
