package com.bonago.trader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { BonagoDashboard() }
    }
}

@Composable
fun BonagoDashboard() {
    var engineUrl by remember { mutableStateOf("") }
    var apiToken by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Not connected") }
    var risk by remember { mutableFloatStateOf(1f) }
    var maxDailyLoss by remember { mutableFloatStateOf(3f) }
    var demoOnly by remember { mutableStateOf(true) }

    MaterialTheme(colorScheme = darkColorScheme()) {
        Scaffold { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                item {
                    Text("BONAGO", style = MaterialTheme.typography.headlineLarge)
                    Text("AI MT5 TRADING CONTROL", style = MaterialTheme.typography.labelMedium)
                }
                item {
                    Card {
                        Column(Modifier.padding(16.dp)) {
                            Text("Connection", style = MaterialTheme.typography.titleLarge)
                            OutlinedTextField(engineUrl, { engineUrl = it }, label = { Text("Engine HTTPS URL") }, singleLine = true)
                            OutlinedTextField(apiToken, { apiToken = it }, label = { Text("API token") }, singleLine = true)
                            Text(status, color = MaterialTheme.colorScheme.secondary)
                            Text("Connect/status controls will activate after the secured VPS API is deployed.")
                        }
                    }
                }
                item {
                    Card {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Account mode", style = MaterialTheme.typography.titleLarge)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(selected = demoOnly, onClick = { demoOnly = true }, label = { Text("DEMO") })
                                FilterChip(selected = !demoOnly, onClick = { demoOnly = true }, label = { Text("LIVE (locked)") })
                            }
                            Text("Live trading is locked in this initial build. Demo mode only.")
                        }
                    }
                }
                item {
                    Card {
                        Column(Modifier.padding(16.dp)) {
                            Text("Risk controls", style = MaterialTheme.typography.titleLarge)
                            Text("Risk per trade: ${risk.toInt()}%")
                            Slider(value = risk, onValueChange = { risk = it }, valueRange = 0.5f..2f)
                            Text("Daily loss limit: ${maxDailyLoss.toInt()}%")
                            Slider(value = maxDailyLoss, onValueChange = { maxDailyLoss = it }, valueRange = 1f..5f)
                            Text("Every trade must have a stop-loss. Daily loss lockout and position caps are enforced by the server.")
                        }
                    }
                }
                item {
                    Card {
                        Column(Modifier.padding(16.dp)) {
                            Text("Trading controls", style = MaterialTheme.typography.titleLarge)
                            Button(onClick = { status = "Engine deployment required — demo trading remains OFF" }, modifier = Modifier.fillMaxWidth()) { Text("Start demo bot") }
                            OutlinedButton(onClick = { status = "Stop requested locally. Connect the VPS to send server stop." }, modifier = Modifier.fillMaxWidth()) { Text("Stop bot") }
                        }
                    }
                }
                item {
                    Text("Risk warning: automated trading can lose money. Test with a broker demo account; never share account passwords or API tokens.")
                }
            }
        }
    }
}
