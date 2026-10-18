<p align="center">
  <img src="docs/screenshots/banner.png" alt="adOmnia" width="100%">
</p>

<p align="center">
  <strong>API 开发、Go 调试和服务检查，集于一个桌面应用。</strong><br>
  一个 API 工作台和 Code Studio，配有数据库、消息、日志和性能分析工具。
</p>

<p align="center">
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest">下载</a> ·
  <a href="https://www.youtube.com/watch?v=tefwLUadRr8">观看演示</a> ·
  <a href="docs/GETTING-STARTED.md">快速入门</a> ·
  <a href="docs/QUICKSTART.it.md">意大利语指南</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.es-ES.md">Español</a> · <a href="README.ja.md">日本語</a> · <strong>简体中文</strong>
</p>

## 截图

### Workspace Hub

从主工作区开始，查看最近的活动，并打开你需要的区域：Code Studio、API 与协议、数据与消息、文档、版本控制或高级工具。

<p align="center">
  <img src="assets/images/ado-hub.png" alt="带有模块快捷方式和最近活动的 adOmnia Workspace Hub" width="100%">
</p>

### Code Studio

编辑并运行 Go 服务，项目树、源码编辑器、终端和上下文相关的 AI 辅助同时显示在同一个工作区中。

<p align="center">
  <img src="assets/images/ado-ide.png" alt="显示 Go 项目、源码编辑器、正在运行的服务和 Claude Code 面板的 Code Studio" width="100%">
</p>

### API Workspace

用集合整理请求，把它们发送到正在运行的服务并检查响应。被识别的路由会直接链接到对应的 Go 处理函数。

<p align="center">
  <img src="assets/images/ado-api.png" alt="显示健康检查请求、响应以及指向其 Go 处理函数的链接的 API Workspace" width="100%">
</p>

### Database Studio

连接 SQLite、PostgreSQL、MySQL、MongoDB 或 Redis，编写查询，并在不离开应用的情况下检查结果、键和历史记录。

<p align="center">
  <img src="assets/images/ado-db.png" alt="已连接 Redis、带有 JSON 命令编辑器和键浏览器的 Database Studio" width="100%">
</p>

### Git Sync

查看分支和提交历史，审阅已更改的文件，暂存选定的改动，并在仓库视图中执行 fetch、pull、push 或 stash 操作。

<p align="center">
  <img src="assets/images/ado-git.png" alt="显示仓库分支、提交图和工作区改动的 Git Sync" width="100%">
</p>

## 演示

**[▶ 在 YouTube 上观看演示](https://www.youtube.com/watch?v=tefwLUadRr8)**

*API Workspace 展示一个请求、它的响应以及关联的 Go 处理函数。点击图片即可观看演示。*

## API 开发与服务调试

adOmnia 把 API 测试和 Go 开发结合在一起。请求可以链接到被检测到的处理函数，针对正在运行的服务执行，并在调试器中检查。数据库、消息、日志和链路追踪工具也在同一个应用中。配置好捕获后，可以追踪与实时请求相关的 SQL、消息和日志。

在 **Code Studio** 中启动的 Go 服务会成为一个 **实时开发会话**。**API Workspace** 可以调用并调试它；被识别的路由会链接回源码。日志以及已配置的 SQL/消息代理捕获也属于同一个工作流。

```text
编写               运行                调用                 理解
Code Studio    →    实时服务        →    API Workspace    →    处理函数 / 断点
                                                                ↕
                                                    变量 · 日志 · SQL · 消息
```

### 核心功能

| 功能 | 说明 |
| --- | --- |
| **API 测试与源码导航** | 可复用的集合、环境、认证和断言，并可直接跳转到被识别的 Go 处理函数。从 API 入手，再顺着它进入正在运行的代码实现。 |
| **以请求驱动的调试** | Debug Request 会启动或复用兼容的 Delve 会话。检查栈帧、变量和 goroutine，单步执行处理函数，再回到响应。 |
| **数据与事件就在请求旁边** | Database、Broker、Log 和 Trace 工具共用同一个应用。配置好捕获后，可以追踪与实时请求相关的 SQL、消息和日志。 |
| **Go 开发与性能分析** | gopls 编辑与导航、测试/覆盖率工作流、Delve、pprof、执行追踪以及架构/影响视图，把源码层面的工作与运行时排查连接起来。 |
| **同一工作流中的企业级协议** | HTTP、SOAP/WSDL、WS-Security、gRPC、WebSocket/SSE、mTLS 和证书工具，既支持现代 API，也支持既有系统。 |
| **依赖安全与经过审阅的修复** | Security Center 扫描 `pom.xml` 和 `go.mod`，把严重程度与被利用的迹象区分开，并在升级之前预览其对安全的影响。安全修复会先显示差异、运行检查，并且只在你审阅之后才应用。 |
| **本地存储与多窗口** | 本地集合和设置、可导出的数据、多个 Go 项目以及原生的工作室窗口。可以把 IDE、API 客户端和辅助工具安排在多个窗口中。 |

### 存储与外部服务

**使用本应用无需账号。** 集合、设置和项目状态都保存在本地。要连接哪些 API、数据库、消息代理和可选的 AI 提供商，由你决定。外部提供商和本地服务都需要你明确选择。

### 项目与窗口

可以把服务放在 Code Studio 中，把它的请求放在 API Workspace 中，并把数据库或消息代理放在它们旁边。在同一个 adOmnia 实例中，可以把另一个 Go 项目打开到它自己的原生窗口里。

这个工作流会保留项目、服务会话、API 请求和可用诊断信息之间的关联。

## 从你的 API 开始

1. 打开 **API Workspace**，创建一个集合和一个请求。
2. 选择方法和 URL，配置 **Body**、**Headers**、**Params** 和认证。
3. 为 `{{baseUrl}}` 这类可复用的值选择一个环境。
4. 点击 **SEND**。检查状态、耗时、响应体、响应头和测试结果。
5. 保存请求以便重新运行，或分享导出的文件。

无需打开 Go 项目也可以使用这些 API 工具。

| 工作流 | 同一工作区中的工具 |
| --- | --- |
| 测试 HTTP API | 集合、环境、认证、响应检查和断言 |
| 使用企业级协议 | SOAP/WSDL、WS-Security、gRPC、mTLS 和证书工具 |
| 跟踪实时连接 | WebSocket 和 SSE 客户端 |
| 重现响应 | Mock 服务器以及代理/拦截器工具 |
| 检查服务数据 | Database Studio 和 Broker Studio |
| 理解故障原因 | 浏览器调试、日志、链路追踪以及已连接的 Go 调试器 |

## 从请求追踪到 Go 代码

1. 通过 **Code Studio → File → Open Project** 打开服务。
2. 信任该文件夹以启用 Go 工具。配置 SDK 和 Run/Debug 配置。
3. 在处理函数上设置断点并开始调试，或在 API 请求的操作中使用 **Debug Request**。
4. 发送对应的请求。对于被识别的路由，**HANDLER** 栏会通过 **OPEN IN GO IDE** 链接到它的源码。
5. 检查暂停时的栈帧、变量、调用栈和 goroutine。单步执行或继续运行，然后回到响应。

配置好捕获/插桩后，SQL、消息代理的消息和日志会让这个工作流更加丰富。它们并不会对每个服务自动可用。首次配置请参阅[操作指南](docs/GETTING-STARTED.md)。

## Code Studio：嵌入工作流中的 IDE

![浅色外观的 Code Studio，在断点处暂停，显示 goroutine 和变量](docs/screenshots/go-debug-light.png)

*Code Studio 在断点处暂停，显示源代码、goroutine、变量和控制台输出。各版本中的控件可能有所不同。*

- **编辑与导航：** gopls 补全、诊断、引用、重命名、重构、项目搜索和 Git。
- **运行、测试与调试：** Go 配置、测试浏览器、覆盖率，以及支持条件断点和 goroutine 检查的 Delve。
- **不止 Go：** TypeScript/JavaScript 和 Web 项目（Vite/npm 脚本、Vitest/Jest 结果、Live Preview）以及 Java（Maven/Gradle、JUnit、Spring Boot、断点和远程附加）使用同一套运行、测试和调试界面。在 `pom.xml` 中，可以到 Maven Central 检查是否有更新的版本，并针对已知漏洞扫描依赖，还能一键更新版本。语言服务器和调试器只会在你确认将要执行的确切命令之后才会安装。
- **理解项目：** 路由、依赖、接口、架构和变更影响视图。
- **度量行为：** pprof 分析、执行追踪、基准测试和并发工具。
- **让工作保持集中：** 终端、本地历史、恢复快照，以及同一个 adOmnia 实例中的多个项目/窗口。
- **AI 辅助：** 基于已配置的提供商和项目策略的上下文辅助；应用更改之前请先审阅。

可以从项目选择器中打开另一个项目。选择 **Open Project in New Window**，把它放在第一个 IDE 旁边；移动之前请保存或放弃未保存的文件。使用 **Studios** 菜单访问周边工具和工作区。

[阅读 Code Studio 指南 →](docs/CODE-STUDIO.md) · [技术参考：IDE 平台 →](docs/CODE-STUDIO-REFERENCE.md)

## 下载与安装

请从 **[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)** 获取 adOmnia。可用的安装包和已知限制请查看发布页面。

| 平台 | 下载 | 安装 |
| --- | --- | --- |
| Windows x64 | `adomnia-<version>-windows-amd64.exe` | 需要 WebView2；可执行文件/按用户安装，不是 MSI 安装向导 |
| macOS Intel / Apple Silicon | `adomnia-<version>-macos-universal.dmg` | 通过 DMG 安装；签名详情请查看发行说明 |
| Linux x64 | `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz` | 需要 GTK 3 和 WebKitGTK 4.1 |

可以在 **Settings** 中检查更新。更新包会校验发布者签名和校验和；安装时会请求确认。操作系统的代码签名与更新程序的包签名是两回事。

[安装与更新](docs/INSTALL.md) · [发行说明与支持范围](docs/releases/v1.0.0.md)

## 实验性功能

局域网协作处于 **测试阶段，需要主动开启**。独立的 LaTeX、Kubernetes/OpenShift、插件市场和 Hub 游戏在 v1 的导航中被隐藏。导入的 PDF 仍会在完整的 PDF 编辑器中打开，但平台支持情况受底层操作系统和工具链限制。

## 文档

| 从这里开始 | 它能帮你做什么 |
| --- | --- |
| [快速入门](docs/GETTING-STARTED.md) · [意大利语指南](docs/QUICKSTART.it.md) | 发送请求、连接 Go 项目并调试处理函数 |
| [安装](docs/INSTALL.md) | 安装、更新并检查平台要求 |
| [Code Studio](docs/CODE-STUDIO.md) | 配置项目、工具、测试、调试器和编辑器 |
| [Code Studio 技术参考](docs/CODE-STUDIO-REFERENCE.md) | 了解 IDE 平台：架构、模块、语言适配器、界面和绑定 |
| [实时会话](docs/LIVE-SESSION.md) | 把请求与代码、日志、SQL 和消息关联起来 |
| [功能参考](docs/adomnia-feature-catalog.en.md) | 了解各个配套工作室 |
| [故障排除](docs/TROUBLESHOOTING.md) · [常见问题](docs/FAQ.md) | 解决配置和工作流方面的问题 |
| [从源码构建](docs/BUILD.md) · [参与贡献](CONTRIBUTING.md) | 构建应用并参与贡献 |

## 反馈与贡献

请[提交问题](https://github.com/Andrea-Cavallo/adOmnia/issues)，并附上你的版本、操作系统和复现步骤。请从截图和导出文件中去除凭据和私人数据。提交拉取请求之前，请先遵循仓库的贡献指南。

感谢 [albertize](https://github.com/albertize) 和 [plunix](https://github.com/plunix) 的贡献。

[MIT 许可证](LICENSE.md)
