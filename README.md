<p align="center">
  <img src="docs/screenshots/banner.png" alt="adOmnia" width="100%">
</p>

<p align="center">
  <strong>API development, Go debugging and service inspection in one desktop application.</strong><br>
  An API workbench and Go IDE with database, messaging, logs and profiling tools.
</p>

<p align="center">
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest">Download</a> ·
  <a href="https://www.youtube.com/watch?v=tefwLUadRr8&amp;t=38s">Watch the demo</a> ·
  <a href="docs/GETTING-STARTED.md">Getting started</a> ·
  <a href="docs/QUICKSTART.it.md">Guida in italiano</a>
</p>

## Screenshots

### Workspace Hub

Start from the main workspace, review recent activity and open the area you need: Go Studio, API and protocols, data and messaging, documentation, version control or power tools.

<p align="center">
  <img src="assets/images/ado-hub.png" alt="adOmnia Workspace Hub with module shortcuts and recent activity" width="100%">
</p>

### Go Studio

Edit and run a Go service with its project tree, source editor, terminal and contextual AI assistance visible in the same workspace.

<p align="center">
  <img src="assets/images/ado-ide.png" alt="Go Studio with a Go project, source editor, running service and Claude Code panel" width="100%">
</p>

### API Workspace

Organize requests in collections, send them to the running service and inspect the response. Recognized routes link directly to their Go handler.

<p align="center">
  <img src="assets/images/ado-api.png" alt="API Workspace with a health request, response and link to its Go handler" width="100%">
</p>

### Database Studio

Connect to SQLite, PostgreSQL, MySQL, MongoDB or Redis, write queries and inspect results, keys and history without leaving the application.

<p align="center">
  <img src="assets/images/ado-db.png" alt="Database Studio connected to Redis with a JSON command editor and key explorer" width="100%">
</p>

### Git Sync

Inspect branches and commit history, review changed files, stage selected work and run fetch, pull, push or stash operations from the repository view.

<p align="center">
  <img src="assets/images/ado-git.png" alt="Git Sync with repository branches, commit graph and working changes" width="100%">
</p>

## Demo

**[▶ Watch the demo on YouTube — starting at 0:38](https://www.youtube.com/watch?v=tefwLUadRr8&t=38s)**

*API Workspace showing a request, its response and the associated Go handler. Select the image to watch the demonstration.*

## API development and service debugging

adOmnia combines API testing and Go development. Requests can be linked to detected handlers, executed against a running service and inspected in the debugger. Database, messaging, log and trace tools share the application. With capture configured, follow the SQL, messages and logs associated with the live request.

A Go service started in **Go Studio** becomes a **live development session**. **API Workspace** can call and debug it; recognized routes link back to their source. Logs and configured SQL/broker captures are part of the same workflow.

```text
WRITE              RUN                CALL                 UNDERSTAND
Go Studio    →    Live service    →    API Workspace    →    Handler / breakpoint
                                                                ↕
                                                    Variables · logs · SQL · messages
```

### Core capabilities

| Capability | Description |
| --- | --- |
| **API testing and source navigation** | Reusable collections, environments, authentication and assertions, with a direct route into recognized Go handlers. Start with an API, then follow its implementation into the running code. |
| **Request-driven debugging** | Debug Request starts or reuses a compatible Delve session. Inspect frames, variables and goroutines, step through the handler and return to the response. |
| **Data and events beside the request** | Database, Broker, Log and Trace tools share the application. With capture configured, follow the SQL, messages and logs associated with the live request. |
| **Go development and profiling** | gopls editing and navigation, test/coverage workflows, Delve, pprof, execution traces and architecture/impact views connect source-level work with runtime investigation. |
| **Enterprise protocols in the same workflow** | HTTP, SOAP/WSDL, WS-Security, gRPC, WebSocket/SSE, mTLS and certificate tools support both modern APIs and existing systems. |
| **Local storage and multiple windows** | Local collections and settings, exportable data, multiple Go projects and native studio windows. Arrange the IDE, API client and supporting tools across windows. |

### Storage and external services

**No account required to use the application.** Collections, settings and project state stay local. You choose the APIs, databases, brokers and optional AI providers to connect to. External providers and local services are chosen explicitly.

### Projects and windows

Keep a service in Go Studio, its requests in API Workspace and its database or broker beside them. Open another Go project in its own native window while staying inside the same adOmnia instance.

The workflow preserves links between the project, service session, API request and available diagnostic evidence.

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

SQL, broker messages and logs enrich this workflow when capture/instrumentation is configured. They are not automatically available for every service. See [the walkthrough](docs/GETTING-STARTED.md) for a first setup.

## Go Studio: the IDE inside the workflow

![Go Studio in the light appearance, paused at a breakpoint with goroutines and variables](docs/screenshots/go-debug-light.png)

*Go Studio paused at a breakpoint, with source code, goroutines, variables and console output. Controls may differ between releases.*

- **Edit and navigate:** gopls completion, diagnostics, references, rename, refactoring, project search and Git.
- **Run, test and debug:** Go configurations, test explorer, coverage and Delve with conditional breakpoints and goroutine inspection.
- **Understand the project:** routes, dependencies, interfaces, architecture and change-impact views.
- **Measure behavior:** pprof profiles, execution traces, benchmarks and concurrency tools.
- **Keep work together:** terminal, local history, recovery snapshots and multiple projects/windows within one adOmnia instance.
- **AI assistance:** contextual assistance with configured providers and project policies; review changes before applying them.

Open another project from the project selector. Choose **Open Project in New Window** to place it beside the first IDE; save or discard unsaved files before moving it. Use the **Studios** menu for surrounding tools and workspaces.

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

LAN collaboration is **beta and opt-in**. Standalone LaTeX, Kubernetes/OpenShift, plugin marketplace and Hub games are hidden from v1 navigation. Imported PDFs still open the complete PDF editor, but platform support is limited by the underlying OS and toolchain.

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

[Report an issue](https://github.com/Andrea-Cavallo/adOmnia/issues) with your version, operating system and reproduction steps. Remove credentials and private data from screenshots and exports. Follow repository contribution guidelines before opening a pull request.

Thanks to [albertize](https://github.com/albertize) and [plunix](https://github.com/plunix) for their contributions.

[MIT license](LICENSE.md)
