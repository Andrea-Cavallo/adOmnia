// The project targets ES2020 typings, but every supported runtime (WebView2, WebKit, Chromium) implements
// ES2022 Error causes. This declares the constructor overload so `new Error(msg, { cause })` type-checks.
interface ErrorOptions {
  cause?: unknown
}

interface ErrorConstructor {
  new (message?: string, options?: ErrorOptions): Error
}
