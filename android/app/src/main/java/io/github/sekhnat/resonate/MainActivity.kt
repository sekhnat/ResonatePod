package io.github.sekhnat.resonate

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.github.sekhnat.resonate.ui.theme.ResonateTheme
import io.github.sekhnat.resonate.ui.theme.ThemeMode

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge to edge: the screens draw under the status and navigation bars, whose icons follow
        // the system's light or dark setting, as ThemeMode.System does.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ResonateTheme {
                WelcomeScreen()
            }
        }
    }
}

/** A placeholder until the library screens exist: the desktop app's welcome, on Nocturne's ground. */
@Composable
fun WelcomeScreen(modifier: Modifier = Modifier) {
    val colors = ResonateTheme.colors
    val spacing = ResonateTheme.spacing
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.bg)
            .safeDrawingPadding()
            .padding(horizontal = spacing.gutter, vertical = spacing.space8),
        verticalArrangement = Arrangement.spacedBy(spacing.space3),
    ) {
        Text(stringResource(R.string.welcome_title), style = ResonateTheme.typography.headlineMd)
        Text(
            stringResource(R.string.welcome_body),
            style = ResonateTheme.typography.bodyMd,
            color = colors.textSecondary,
        )
    }
}

@Preview(name = "Dark", widthDp = 360, heightDp = 640)
@Composable
private fun WelcomeDarkPreview() {
    ResonateTheme(ThemeMode.Dark) { WelcomeScreen() }
}

@Preview(name = "Light", widthDp = 360, heightDp = 640)
@Composable
private fun WelcomeLightPreview() {
    ResonateTheme(ThemeMode.Light) { WelcomeScreen() }
}
