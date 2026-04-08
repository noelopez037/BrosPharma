import ExpoModulesCore

public class HttpSessionResetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HttpSessionReset")

    // Resets URLSession.shared — flushes all cached responses, credentials,
    // and most importantly closes every pooled TCP connection.
    // After this call, the next fetch opens a brand-new connection, exactly
    // like the app had been killed and relaunched.
    AsyncFunction("resetAsync") { (promise: Promise) in
      URLSession.shared.reset {
        promise.resolve(nil)
      }
    }
  }
}
