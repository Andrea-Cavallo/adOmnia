<p align="center">
  <img src="docs/screenshots/banner.png" alt="adOmnia" width="100%">
</p>

<p align="center">
  <strong>Your API, your code, your runtime. One connected desktop workspace.</strong><br>
  Build a Go service. Call its API. Stop at the handler. Inspect the response, logs, database and messages.
</p>

<p align="center">
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest">Download</a> ·
  <a href="https://www.youtube.com/watch?v=tefwLUadRr8&amp;t=38s">Watch the demo</a> ·
  <a href="docs/GETTING-STARTED.md">Getting started</a> ·
  <a href="docs/QUICKSTART.it.md">Guida in italiano</a>
</p>

## See the connected workflow

[![Watch the demo: API request, Go handler and successful response](docs/screenshots/api-connected.png)](https://www.youtube.com/watch?v=tefwLUadRr8&t=38s)

**[▶ Watch the demo on YouTube — starting at 0:38](https://www.youtube.com/watch?v=tefwLUadRr8&t=38s)**

*A real desktop session: request and response beside the Go handler serving the endpoint. The preview opens the video; GitHub does not embed a YouTube player.*

## Why adOmnia

An API client tells you what a service returned. An IDE shows you the code. adOmnia connects both: a service started in **Go Studio** becomes a live session you can call, debug and inspect from **API Workspace**.

```text
Go source → Run / Debug → API request → breakpoint → inspect → response
                                          ↕
                              logs · SQL · broker messages
```

Collections, environments, API tools and project windows belong to one application. Open multiple Go projects, place an IDE on another monitor and keep API Workspace beside it. Each project keeps its own editor and tooling session.

Workspaces and settings stay local. No account is required. External APIs and optional AI providers connect as configured; review the data you share with a provider.

## Start with your API

1. Open **API Workspace** and create a collection and request.
2. Choose a method and URL. Configure **Body**, **Headers**, **Params** and authentication.
3. Choose an environment for reusable values such as `{{baseUrl}}`.
4. Press **SEND**. Inspect the status, timing, response body, headers and test results.
5. Save the request to rerun it or share an export.

You can use the API tools without opening a Go project.

| Workflow | Tools in the same workspace |
| --- | --- |
| Test HTTP APIs | Collections, environments, authentication, response inspection and assertions |
| Work with enterprise protocols | SOAP/WSDL, WS-Security, gRPC, mTLS and certificate tools |
| Follow live connections | WebSocket and SSE clients |
| Reproduce responses | Mock server and proxy/interceptor tools |
| Inspect service data | Database Studio and Broker Studio |
| Understand failures | Browser debugging, logs, traces and the connected Go debugger |

## Follow a request into Go code

1. Open the service in **Go Studio → File → Open Project**.
2. Trust the folder to enable Go tools. Configure the SDK and Run/Debug configuration.
3. Set a handler breakpoint and start debugging, or use **Debug Request** from the API request actions.
4. Send the matching request. For a recognized route, the **HANDLER** strip links to its source with **OPEN IN GO IDE**.
5. Inspect the paused frame, variables, stack and goroutines. Step or continue, then return to the response.

SQL, broker messages and logs enrich this workflow when capture/instrumentation is configured. They are not automatically available for every service. See [the walkthrough](docs/GETTING-STARTED.md) and [Live Development Sessions](docs/LIVE-SESSION.md).

## Go Studio: the IDE inside the workflow

![Go Studio in the light appearance, paused at a breakpoint with goroutines and variables](docs/screenshots/go-debug-light.png)

*Source, breakpoint, goroutines, variables and console together. Screenshots show real sessions; individual controls can differ between releases.*

- **Edit and navigate:** gopls completion, diagnostics, references, rename, refactoring, project search and Git.
- **Run, test and debug:** Go configurations, test explorer, coverage and Delve with conditional breakpoints and goroutine inspection.
- **Understand the project:** routes, dependencies, interfaces, architecture and change-impact views.
- **Measure behavior:** pprof profiles, execution traces, benchmarks and concurrency tools.
- **Keep work together:** terminal, local history, recovery snapshots and multiple projects/windows within one adOmnia instance.
- **Use AI deliberately:** contextual assistance with configured providers and project policies; review changes before applying them.

Open another project from the project selector. Choose **Open Project in New Window** to place it beside the first IDE; save or discard unsaved files before moving it. Use the **Studios** menu for API Workspace, Database or Broker beside the code.

[Read the Go Studio guide →](docs/GO-STUDIO.md)

## Download and install

Get adOmnia from **[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)**. Check the release page for available assets and known limitations.

| Platform | Download | Setup |
| --- | --- | --- |
| Windows x64 | `adomnia-<version>-windows-amd64.exe` | Requires WebView2; executable/per-user installation, not an MSI wizard |
| macOS Intel / Apple Silicon | `adomnia-<version>-macos-universal.dmg` | Install from the DMG; check signing details in release notes |
| Linux x64 | `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz` | Requires GTK 3 and WebKitGTK 4.1 |

Check for updates in **Settings**. Update packages verify the publisher signature and checksum; installation asks for confirmation. OS code signing is separate from updater package signing.

[Installation and updates](docs/INSTALL.md) · [Release notes and support limits](docs/releases/v1.0.0.md)

## What is experimental

LAN collaboration is **beta and opt-in**. Standalone LaTeX, Kubernetes/OpenShift, plugin marketplace and Hub games are hidden from v1 navigation. Imported PDFs still open the complete PDF editor, including PDFs opened from Go Studio. See [the v1 scope](mds/V1-RELEASE-SCOPE-TODO.md).

## Documentation

| Start here | What it helps you do |
| --- | --- |
| [Getting started](docs/GETTING-STARTED.md) · [Italian guide](docs/QUICKSTART.it.md) | Send requests, connect a Go project and debug a handler |
| [Installation](docs/INSTALL.md) | Install, update and check platform requirements |
| [Go Studio](docs/GO-STUDIO.md) | Configure projects, tools, tests, debugger and editor |
| [Live sessions](docs/LIVE-SESSION.md) | Connect requests with code, logs, SQL and messages |
| [Feature reference](docs/adomnia-feature-catalog.en.md) | Explore the supporting studios |
| [Troubleshooting](docs/TROUBLESHOOTING.md) · [FAQ](docs/FAQ.md) | Resolve setup and workflow problems |
| [Build from source](docs/BUILD.md) · [Contributing](CONTRIBUTING.md) | Build the application and contribute |

## Feedback and contributions

[Report an issue](https://github.com/Andrea-Cavallo/adOmnia/issues) with your version, operating system and reproduction steps. Remove credentials and private data from screenshots and exports. For security reports, follow [the security policy](.github/SECURITY.md).

Thanks to [albertize](https://github.com/albertize) and [plunix](https://github.com/plunix) for their contributions.

[MIT license](LICENSE.md)
