package expo.modules.httpsessionreset

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HttpSessionResetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HttpSessionReset")

    // Evicts all idle connections from React Native's OkHttp connection pool.
    // Android's connection handling is more resilient than iOS, but this
    // ensures a clean slate after returning from background.
    AsyncFunction("resetAsync") {
      try {
        val networkModule = appContext.reactContext
          ?.getNativeModule(com.facebook.react.modules.network.NetworkingModule::class.java)
        val field = networkModule?.javaClass?.getDeclaredField("mClient")
        field?.isAccessible = true
        val client = field?.get(networkModule) as? okhttp3.OkHttpClient
        client?.connectionPool?.evictAll()
      } catch (_: Exception) {
        // Non-critical: if reflection fails, just continue.
      }
    }
  }
}
