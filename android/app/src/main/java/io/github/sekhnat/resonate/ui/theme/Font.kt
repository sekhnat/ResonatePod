package io.github.sekhnat.resonate.ui.theme

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import io.github.sekhnat.resonate.R

// The only Android-specific file in the theme: it reads the bundled font resource.
// res/font/inter_variable.ttf is Inter 4.1's variable font (SIL OFL 1.1, see android/third_party).
// One file serves every weight through the variable 'wght' axis, which needs API 26.

/** Inter at the three weights Nocturne uses: 400 body, 500 headings and labels, 600 monograms. */
internal val InterFamily: FontFamily = FontFamily(
    inter(FontWeight.Normal),
    inter(FontWeight.Medium),
    inter(FontWeight.SemiBold),
)

@OptIn(ExperimentalTextApi::class)
private fun inter(weight: FontWeight) = Font(
    resId = R.font.inter_variable,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)
