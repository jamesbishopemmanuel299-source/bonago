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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { BonagoDashboard() }
    }
}

private data class ApiResult(val code: Int, val body: String)

private fun apiCall(baseUrl: String, token: String, path: String, method: String = "GET"): ApiResult {
    val cleanBase = baseUrl.trim().trimEnd('/')
    require(cleanBase.startsWith("https://")) { "Use a secure HTTPS engine URL." }
    val connection = (URL(cleanBase + path).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 12000
        readTimeout = 12000
        setRequestProperty("X-Bot-Token", token)
        setRequestProperty("Accept", "application/json")
        if (method == "POST") {
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            outputStream.use { it.write("{}".toByteArray()) }
        }
    }
    return try {
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
        ApiResult(code, body)
    } finally {
        connection.disconnect()
    }
}

@Composable
fun BonagoDashboard() {
    var engineUrl by remember { mutableStateOf("") }
    var apiToken by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Not connected") }
    var busy by remember { mutableStateOf(false) }
    var account by remember { mutableStateOf("No account loaded") }
    var botStatus by remember { mutableStateOf("Bot stopped") }
    var risk by remember { mutableFloatStateOf(1f) }
    var maxDailyLoss by remember { mutableFloatStateOf(3f) }
    val scope = rememberCoroutineScope()

    fun perform(path: String, method: String = "GET", onResult: (ApiResult) -> Unit) {
        if (engineUrl.isBlank() || apiToken.isBlank()) {
            status = "Enter the HTTPS engine URL and API token first."
            return
        }
        if (busy) return
        busy = true
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { apiCall(engineUrl, apiToken, path, method) }
                onResult(result)
            } catch (e: Exception) {
                status = e.message ?: "Connection failed"
            } finally {
                busy = false
            }
        }
    }

    MaterialTheme(colorScheme = darkColorScheme()) {
        Scaffold { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                item {
                    Text("BONAGO", style = MaterialTheme.typography.headlineLarge)
                    Text("MT5 TRADING CONTROL", style = MaterialTheme.typography.labelMedium)
                    Text("Connect from Android to your secured Windows VPS. MT5 desktop runs on the VPS, not on this phone.")
                }
                item {
                    Card {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("VPS connection", style = MaterialTheme.typography.titleLarge)
                            OutlinedTextField(engineUrl, { engineUrl = it }, label = { Text("Engine HTTPS URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(apiToken, { apiToken = it }, label = { Text("VPS API token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Button(enabled = !busy, onClick = {
                                perform("/health") { result ->
                                    if (result.code in 200..299) {
                                        status = "Engine reachable. Checking MT5 demo account…"
                                        perform("/account") { accountResult ->
                                            if (accountResult.code in 200..299) {
                                                val json = JSONObject(accountResult.body)
                                                account = "Broker: ${json.optString("broker")}\nServer: ${json.optString("server")}\nLogin: ${json.optLong("login")}\nCurrency: ${json.optString("currency")}\nBalance: ${json.optDouble("balance")}\nEquity: ${json.optDouble("equity")}\nMode: ${json.optString("mode")}"
                                                status = "Connected to MT5 demo account"
                                                perform("/bot/status") { sr ->
                                                    if (sr.code in 200..299) botStatus = if (JSONObject(sr.body).optBoolean("running")) "Bot running" else "Bot stopped"
                                                }
                                            } else status = "Engine reached, but MT5 account check failed: ${accountResult.body}"
                                        }
                                    } else status = "Engine error (${result.code}): ${result.body}"
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Connecting…" else "Connect and load account") }
                            Text(status, color = MaterialTheme.colorScheme.secondary)
                            Text(account, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                item {
                    Card {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Account mode", style = MaterialTheme.typography.titleLarge)
                            Text("DEMO ONLY — live trading is locked.")
                            Text("Bot: $botStatus")
                        }
                    }
                }
                item {
                    Card {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Risk preferences (display only)", style = MaterialTheme.typography.titleLarge)
                            Text("Risk per trade: ${risk.toInt()}%")
                            Slider(value = risk, onValueChange = { risk = it }, valueRange = 0.5f..2f)
                            Text("Daily loss preference: ${maxDailyLoss.toInt()}%")
                            Slider(value = maxDailyLoss, onValueChange = { maxDailyLoss = it }, valueRange = 1f..5f)
                            Text("These sliders are not yet enforced by the server.")
                        }
                    }
                }
                item {
                    Card {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Bot controls", style = MaterialTheme.typography.titleLarge)
                            Button(enabled = !busy, onClick = {
                                perform("/bot/start", "POST") { result ->
                                    status = if (result.code in 200..299) "Start request accepted: ${result.body}" else "Bot not started (${result.code}): ${result.body}"
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text("Start demo bot") }
                            OutlinedButton(enabled = !busy, onClick = {
                                perform("/bot/stop", "POST") { result ->
                                    status = if (result.code in 200..299) {
                                        botStatus = "Bot stopped"
                                        "Stop request sent."
                                    } else "Stop failed (${result.code}): ${result.body}"
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text("Stop bot") }
                        }
                    }
                }
                item {
                    Text("Security: use HTTPS. The API token stays in this screen's memory and is not saved by this app. Never share MT5 passwords or VPS tokens.")
                    Text("Automated order execution is not enabled in this starter. A successful connection does not mean trades are being placed.")
                }
            }
        }
    }
}
