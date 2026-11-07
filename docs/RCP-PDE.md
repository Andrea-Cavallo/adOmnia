# Eclipse RCP / PDE in adOmnia

Code Studio can open, understand, run, debug and package legacy Eclipse RCP/PDE workspaces without leaving adOmnia. This guide covers the full workflow: target platforms, language intelligence on PDE bundles, Eclipse applications, `plugin.xml` extensions, the Dependency Explorer, p2 repositories and export.

It is the reference for the OSGi/PDE section of [CODE-STUDIO.md](CODE-STUDIO.md). The implementation lives in `internal/eclipsepde` (workspace, target, resolver, p2, launch, export), `internal/codestudio/service_java_osgi*` (bindings) and `frontend/src/components/code-studio/CodeStudioJavaOsgi*` (UI).

## Design rules

- **Local-first.** Everything is read from the workspace, the target platform, a local Eclipse installation and the adOmnia caches. No Eclipse process is required for analysis.
- **Never write Eclipse metadata.** adOmnia reads `.project`, `MANIFEST.MF`, `plugin.xml`, `feature.xml`, `.product` and `.launch`; it never rewrites them. Edits are explicit (manifest headers, target selection) and go through the existing editors.
- **Trusted projects only for anything that runs.** Build, run, debug, p2 download and export require the project to be trusted.
- **Static first, honest about uncertainty.** Diagnostics and graphs are static analysis. Where Equinox may resolve differently at runtime, the UI says so.
- **No second build system.** The real build stays on the target's ECJ at each bundle's execution level; Maven/Gradle remain the build for plain Java projects.

## Prerequisites

| Requirement | Why |
|---|---|
| An Eclipse/PDE workspace | A `.project` with a `META-INF/MANIFEST.MF`, or the opened folder itself; nested workspaces up to four levels are found. |
| A target platform | A folder of bundles, an Eclipse installation (e.g. Kepler), a `.target` file, or a target generated from a Tycho `pom.xml`. Without it there is no dependency resolution. |
| A Java JDK | Selected in the status bar or `.adomnia/java.local.json`. The same JDK is used for the build, the Equinox launch and (when available) JDT LS. |
| Project trust | Required for `Build OSGi Bundles`, Equinox Run/Debug, p2 download, export and JDT LS on the shadow workspace. |

The target selection is stored in `.adomnia/eclipse-target.json` (relative to the project when possible, so it can be committed). The target index is cached and reused until a jar, a manifest or the `.target` changes; *Reindex* forces a rebuild.

## Opening the OSGi Control Center

*Java → OSGi Control Center…* opens the OSGi Control Center for the active session. Tabs:

| Tab | What it shows |
|---|---|
| **Bundles** | Every workspace bundle with state, source (workspace/target), version, Activator, start level; filters and search. Selecting one opens its manifest, wiring, diagnostics, impact and focused graph. |
| **Graph** | The bundle dependency graph, focused on the selected bundle. |
| **Activators** | Activators and activation order, with breakpoint actions. |
| **Diagnose** | Resolution diagnostics at the exact manifest line: missing `Require-Bundle`, `Import-Package`, `Fragment-Host`, range problems, singleton/version warnings, `uses` conflicts, extension/class problems. |
| **Runtime** | The framework started by adOmnia: ACTIVE states, registered services and Equinox diagnostics. |
| **Applications** | `.product` and PDE `.launch` files, with Run and Debug. |
| **Dependencies** | Dependency Explorer: class/package → provider → consumers → missing declarations. |
| **Target** | Active target, its bundles, comparison with another target, reindex and p2 download. |

### Target platforms

- **Folder** — a folder of bundles or an Eclipse installation. *Folder…* selects it.
- **`.target` definition** — *.target…* reads its locations, filters and installable units.
- **Tycho** — *Target from pom.xml* reads the p2 repositories of the build, including the parents it inherits from (`<relativePath>`, default `../pom.xml`) and their properties, and writes `.adomnia/tycho.target`. Only the closure the workspace requires is downloaded.
- **p2 installable units** — *Download p2 bundles…* resolves the units like PDE (planner or slicer, platform filters, `includeSource`), shows the repositories before downloading, verifies checksums and stores bundles in the machine-wide cache (`<user cache>/adOmnia/eclipse-p2`). Proxy, company CA, offline mode and the connection log follow the network settings; the download can be cancelled and works offline afterwards.

Repositories that publish only `content.xml.xz` / `artifacts.xml.xz` are supported (tried after `.jar` and before `.xml`). This covers many modern Eclipse mirrors.

## Language intelligence: JDT LS on a shadow workspace

JDT LS cannot read an Eclipse target platform and does not understand PDE natures, so adOmnia normally keeps it away from PDE projects. Once a target platform is chosen, it starts JDT LS on a **shadow workspace** instead:

- Location: the adOmnia tools folder, `jdtls-pde/<project>` (outside the project, never committed).
- One plain Java project per workspace bundle.
- Source folders are `.classpath` links to the **real** source folders. The editor always opens real files.
- The target bundles the manifest requires are libraries; workspace bundles are project references.
- Compliance is **1.8** (the lowest JDT LS accepts). A Java 6 bundle's sources remain valid 1.8; the real build still uses the target's ECJ at the bundle's own execution level.

What works on real files:

- completion across bundles and target types;
- errors while typing;
- go-to-definition and find-usages across bundles;
- the Java debugger, including breakpoints in bundle sources.

Rules and limits:

- Without a target platform the server stays off and the status bar says why.
- The shadow workspace is rewritten at every server start. A changed `MANIFEST.MF` needs a restart of the Java language server (status bar language-server menu or the editor's notice).
- A plain Maven/Gradle project that declares Java 1.6/1.7 (`maven.compiler.source/target/release`, `sourceCompatibility`) is still not handed to JDT LS; Maven/Gradle compile it on the selected JDK.
- JDT LS costs roughly 400 MiB. Java projects start it when selected (or when a file opens); restored background projects do not start one each at launch.

## Eclipse applications: `.product` and `.launch`

The **Applications** tab lists every `.product` and every PDE launch configuration of the workspace projects that starts an Eclipse application (Eclipse Application, OSGi Framework). Other launch types (JUnit, plain Java) are ignored.

Each entry shows what it launches and offers **Run** and **Debug**.

A launch:

- starts the plug-ins listed by the product/launch, or the plug-ins of its features (included features followed, from the workspace and the target's `features/` folder), plus everything they require;
- applies the product's start levels (`<configurations>`);
- passes VM and program arguments, including the ones specific to this OS;
- passes `-product` / `-application`;
- uses `.adomnia/osgi/<name>/workspace` as the instance location unless the arguments set `-data`;
- writes its configuration to `.adomnia/osgi/<name>/` (git-ignored);
- stops when the application returns (`-Dosgi.noShutdown=false`, no console), so the Run console shows the exit code.

A plug-in or feature listed but present in neither the workspace nor the target is reported as a problem, not treated as fatal.

**Debug** starts the same launch with JDWP on a free loopback port and `suspend=y`, then attaches the Java debugger. Breakpoints in the real bundle sources stop, including `Activator.start`.

## Extensions: `plugin.xml` / `fragment.xml`

The bundle detail includes:

- **Extension points** declared by the bundle, with the workspace bundles that extend them.
- **Extensions** contributed by the bundle: the point, the extension id, the `plugin.xml` line, and every class named by platform attributes (`class`, `defaultHandler`, `handler`, `contributorClass`, `launcher`, `delegate`). A class with source in the bundle opens at its file; a class outside the bundle falls back to the `plugin.xml` line.

Diagnostics reported by **Diagnose**:

- an extension of a point that no bundle (workspace or target) declares;
- a class named by an extension that is missing from the bundle's own packages (usually a typo).

Target extension points are read once per jar and cached. The **Flow Explorer** has an `extension-point` node: a bundle refers to the points it extends, and a point starts the classes its extensions name.

## Dependency Explorer

*Dependencies* answers the classic RCP failure: a class is visible at compile time but missing at runtime.

Input: a fully qualified class (`org.eclipse.swt.widgets.Shell`) or a package (`org.eclipse.swt.widgets`, or a path such as `org/acme/Foo.java`).

The result shows:

- **Exported by** — workspace and target bundles that export the package, with bundle version, source (`workspace`/`target`) and export version.
- **Used by** — workspace bundles that use it through `Import-Package` or `Require-Bundle`, the provider the resolver wires them to, and the first matching `import` in their sources (one click to the line).
- **Missing** — bundles whose sources import the package while `MANIFEST.MF` declares neither `Import-Package` nor `Require-Bundle`: the runtime `ClassNotFoundException` case.
- **JRE** — packages provided by the JRE are marked and never reported as missing.

Limits:

- It reads `import` statements. A fully qualified use without an import is not seen.
- The source scan is bounded (5,000 files per bundle) to keep large workspaces responsive.
- It is a static lookup: it does not prove what a running class loader actually wired.

## Resolver accuracy: `uses` conflicts

Diagnose enforces the class-space constraint Equinox applies: when a bundle gets package `p` from a provider whose export says `uses:="q"`, the bundle must see `q` from the same provider. A violation is reported with both providers, the export clause as evidence and suggested actions.

- The check is **one constraint level deep** — the level that reports nearly every real conflict. Equinox may still find a wiring this static pick did not try.
- The resolver matches Equinox 3.9.1 in PDE development mode, verified by a differential test on a real Kepler target (104 bundles, states and wiring).
- Equinox at runtime is stricter: an unresolved dependency and the older version of a singleton appear as warnings here; a `uses` violation may only surface at runtime.
- The Equinox launch has not been verified against every real Eclipse installation. Treat the static state as a strong diagnostic, not a guarantee.

## Export and p2 publishing

Build the bundles first (*Java → Build OSGi Bundles*): export reads their output folders.

### Bundles and features

*Java → Export OSGi Bundles…* (or **Export…** in the Control Center) writes:

- `plugins/<id>_<version>.jar` for every compiled bundle, from its `bin.includes` (`.` = output folder, `bin.excludes` honoured, manifest first);
- `features/<id>_<version>.jar` for every workspace feature, with the real versions of its plug-ins.

PDE rules are applied:

- `.qualifier` is replaced by `vYYYYMMDD-HHMM` (UTC);
- feature plug-ins declared at `0.0.0` are pinned to the exported (or target) version;
- problems (missing files, unresolved feature plug-ins) are reported with the project name.

The output folder has the layout of an Eclipse installation (`plugins/`, `features/`), so it can be used as a dropins folder or as p2 publisher input.

### p2 repository

*Java → Export OSGi Bundles as p2 Repository…* exports the same layout and then runs the target's own `FeaturesAndBundlesPublisher` on the project JVM:

- output: `content.jar` / `artifacts.jar` next to the jars;
- configuration area: `.adomnia/osgi/p2-publisher` (the Eclipse installation is never written);
- progress and output in the Run console.

It needs an Eclipse SDK installation as target (launcher and p2 publisher bundles). Without it the publish step fails with that reason.

**Not included:** exporting a runnable product (`.product` binary, native launcher, branded application). The current export covers bundles, features and a p2 repository; a full product export is a separate PDE build.

## Files and caches

| Path | Content | Committed? |
|---|---|---|
| `.adomnia/eclipse-target.json` | Active target selection (relative when inside the project) | Shareable; commit it to share the target |
| `.adomnia/tycho.target` | Target generated from `pom.xml` | Usually committed or generated on demand |
| `.adomnia/osgi/` | Equinox config, `dev.properties`, app launcher configs, p2 publisher config | Git-ignored |
| `.adomnia/osgi/<name>/workspace` | Instance location of a launched application | Git-ignored |
| `<tools>/jdtls-pde/<project>` | Shadow workspace for JDT LS | Outside the project |
| `<user cache>/adOmnia/eclipse-p2` | Downloaded p2 bundles (machine-wide) | Outside the project |
| `plugins/<name>` | Plug-ins imported into the workspace | Depends on your repository policy |

## Commands and agents

Java menu / command palette:

- *OSGi Control Center…*
- *Build OSGi Bundles*
- *Run OSGi Bundles in Equinox*
- *Debug OSGi Bundles in Equinox*
- *Export OSGi Bundles…*
- *Export OSGi Bundles as p2 Repository…*
- *Flow Explorer…*

The same operations are exposed to agents through the `adomnia mcp` server: `osgi_workspace`, `osgi_bundles`, `osgi_bundle`, `osgi_search`, `osgi_impact`, `osgi_diagnose`, `osgi_resolve`, `osgi_target`, `osgi_runtime_start` / `osgi_runtime_snapshot` / `osgi_runtime_stop`, plus `workspace_*` file tools. With `--write` (or `ADOMNIA_MCP_WRITE=1`): `osgi_set_target`, `osgi_manifest_set`, `osgi_manifest_requirement`, `osgi_import_plugins`, `osgi_add_target_jars`. Tools read/write the project folder directly; the desktop app does not need to be open.

## Security and privacy

- No network calls except explicit p2 download and source downloads; they go through the network policy (proxy, CA, offline mode, connection log).
- p2 metadata and artifacts are size-bounded (256 MiB metadata, 512 MiB artifact, depth 6, 5-minute request timeout) and checksum-verified before use.
- Nothing is launched without trust. Exported p2 publishing runs the target's publisher on the project JVM, not an adOmnia-built binary.
- `.adomnia/osgi` and the JDT LS shadow workspace are outside version control.
- Secrets are not read from product/launch files; environment values follow the existing run-configuration rules.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Target shows no bundles | Wrong folder, or the folder is not an Eclipse installation. Pick the folder that contains `plugins/` or the Eclipse root. Reindex. |
| A target bundle is "not resolved" | Missing transitive dependency or wrong version. Open the bundle detail; Diagnose names the exact header and line. |
| Java completion is local-only | No target platform selected, JDT LS not installed/trusted, or the project is not a PDE workspace. The status bar shows the reason. |
| Manifest changes are ignored by the editor | The shadow workspace is rewritten at server start. Restart the Java language server (status bar menu or the editor's language-server notice). |
| `uses` conflict reported but the app runs | The check is one level deep and the runtime may pick a different wiring. Treat it as a warning, not a hard failure. |
| Application does not start | Open the Run console: the launcher reports missing plug-ins/features, bad `-application`/`-product`, or a busy port. A missing root is a problem, not fatal. |
| Debugger does not attach | Debug starts with `suspend=y`; give it a moment, or check that the debugger tool window is open and the JDK is the same one used by the application. |
| p2 download fails | Check the repository URL, proxy/CA settings and offline mode; `.xz` metadata is supported, but the repository must still publish valid checksums. |
| Export produces nothing | Build the bundles first. Export reads the output folders; a bundle without a manifest or `bin.includes` is reported as a problem. |
| p2 publish fails | The active target must be an Eclipse SDK installation with the launcher and p2 publisher bundles. |

## Manual acceptance checklist

Use a real PDE workspace and an Eclipse target (Kepler or newer). A suggested check, to run in `wails3 task dev`:

1. Open the workspace, select a target and confirm Bundles, Graph and Diagnose show the expected states.
2. Open a bundle source: completion across bundles, an error while typing, go-to-definition into the target.
3. Change a `MANIFEST.MF` import, restart the Java language server and confirm the editor classpath follows.
4. Run a `.product` and a `.launch`, then Debug one and stop in `Activator.start`.
5. Open `plugin.xml`: extension points, extensions, source jumps; introduce a typo in a class name and confirm Diagnose reports it at the line.
6. Use the Dependency Explorer on a class exported by the target and on one imported without a manifest entry.
7. Trigger a `uses` conflict (or use a known target) and confirm the report names both providers.
8. Build, export `plugins/`/`features/`, then publish a p2 repository; verify `content.jar` and `artifacts.jar`.
9. Download a target whose metadata is only `.xml.xz` and confirm it resolves offline afterwards.
10. Revoke trust: build/run/debug/export must be refused, analysis may still read.
