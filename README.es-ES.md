<p align="center">
  <img src="docs/screenshots/banner.png" alt="adOmnia" width="100%">
</p>

<p align="center">
  <strong>Un IDE de Go y una caja de herramientas API completa en una sola aplicación de escritorio local-first.</strong><br>
  Escribe el servicio, ejecútalo, llámalo, depúralo — e inspecciona su base de datos, sus mensajes y sus logs sin salir del espacio de trabajo.
</p>

<p align="center">
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/Andrea-Cavallo/adOmnia?color=8A2BE2"></a>
  <a href="https://github.com/Andrea-Cavallo/adOmnia/actions/workflows/build.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Andrea-Cavallo/adOmnia/build.yml?branch=main&label=build"></a>
  <a href="LICENSE.md"><img alt="Licencia: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://www.adomnia-dev.com"><img alt="Sitio web" src="https://img.shields.io/badge/website-adomnia--dev.com-8A2BE2"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>Español</strong>
</p>

<p align="center">
  <a href="#descarga">Descarga</a> ·
  <a href="#go-studio">gO Studio</a> ·
  <a href="#herramientas-de-api-y-runtime">Herramientas API</a> ·
  <a href="#entiende-tu-código">Análisis de código</a> ·
  <a href="#línea-de-comandos-y-ci">CLI</a> ·
  <a href="#compilar-desde-el-código-fuente">Compilación</a> ·
  <a href="#documentación">Documentación</a>
</p>

---

## Por qué adOmnia

La mayoría de los desarrolladores alternan entre un IDE, un cliente API, una interfaz para bases de datos, una herramienta para Kafka, un visor de logs y una terminal. adOmnia los reúne en una sola aplicación donde comparten contexto: un servicio Go iniciado en **gO Studio** se convierte en una **sesión en vivo** que el cliente API, el depurador, el explorador de bases de datos y el inspector de logs ven a la vez.

- **Local-first.** Sin cuenta, sin telemetría, sin sincronización en la nube. Tus datos se quedan en tu máquina.
- **Un solo flujo.** `código → servicio en ejecución → solicitud API → breakpoint → código → respuesta`.
- **Listo para la empresa.** SOAP/WSDL con WS-Security, mTLS con PEM y JKS, OAuth 2.0, AWS Signature v4, y proxies o VPN en equipos corporativos.
- **Multiplataforma.** Windows, macOS y Linux, distribuido como un único ejecutable.
- **Lado a lado.** Cualquier módulo — API Workspace, Database, Broker, Mock Server, Docker Lab — se abre en su propia ventana nativa, junto al código o en otro monitor.

![El Hub de adOmnia](docs/screenshots/hub-dark.png)

## Descarga

Obtén la última versión en **[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)**.

| Plataforma | Archivo | Requisitos |
| --- | --- | --- |
| Windows x64 | `adomnia-<version>-windows-amd64.exe` | WebView2 runtime |
| macOS (Intel y Apple Silicon) | `adomnia-<version>-macos-universal.dmg` | — |
| Linux x64 | `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz` | GTK 3, WebKitGTK 4.1 |

Cada versión incluye `SHA256SUMS.txt`. Consulta la [guía de instalación](docs/INSTALL.md) para los pasos de cada plataforma. Las plantillas para Scoop, Homebrew, Snap y Flatpak están en [`packaging/`](packaging/README.md); usa GitHub Releases hasta que esos canales estén publicados.

### Primeros pasos

1. **Abre un proyecto Go:** en **gO Studio**, elige *Open Folder* sobre una carpeta con `go.mod` y márcala como confiable para activar gopls, Run, Debug y los tests.
2. **Envía una solicitud:** en **API Workspace**, crea una **New Request**, define método, URL, cabeceras, autenticación y cuerpo, y envíala.
3. **Conéctalos:** ejecuta el servicio desde gO Studio y usa **Debug Request** para detenerte en el breakpoint de tu handler.

## gO Studio

gO Studio es el IDE de Go integrado en adOmnia, pensado para el trabajo diario con Go en máquinas reales.

![gO Studio](docs/screenshots/ide-dark.png)

| Área | Qué obtienes |
| --- | --- |
| **Edición** | Autocompletado, navegación, renombrado, Change Signature y otras refactorizaciones con gopls; diagnósticos y correcciones rápidas; golangci-lint, staticcheck y SonarQube opcional; un editor de merge a tres vías. |
| **Ejecución y tests** | Ejecución desde el margen, explorador de tests con cobertura, targets de Makefile, Dockerfiles y servicios de compose, y una consola Run que colorea los niveles de log. |
| **Depuración** | Delve con breakpoints condicionales, por número de pasadas y por función, logpoints y Run to Cursor. Una vista centrada en la concurrencia agrupa las goroutines por origen. |
| **Análisis Go** | Grafo de dependencias con versiones, licencias, actualizaciones y `govulncheck`; un editor visual de `go.mod`; un inspector de la propagación de `context.Context`. |
| **Espacio de trabajo** | Git en el editor con un diálogo de commit de dos paneles, terminal integrada, historial local, recuperación de buffers sin guardar tras un fallo, y un diseño modular donde cualquier herramienta se puede mover, maximizar o separar en su propia ventana. |
| **Arrancar todo** | *Run → Start Workspace* detecta archivos Compose y paquetes `main` e inicia todo el entorno local como una sola ejecución compuesta. |
| **Remoto y nube** | Las configuraciones de ejecución apuntan a distribuciones WSL, hosts SSH o contenedores en marcha. Kubernetes Studio cubre pods, deployments, services, config maps y secrets (solo nombres de claves), con Delve y pprof redirigidos desde un pod. |
| **Toolchain** | Usa el SDK de Go del proyecto, `GOPROXY`, `GOPRIVATE`, `CGO_ENABLED`, `GOOS`/`GOARCH` y build tags por proyecto; cambiar de SDK reinicia gopls; sin descargas silenciosas de toolchains. |

**Modelo de confianza.** Un proyecto recién abierto se puede explorar y editar, pero ninguna herramienta de Go, compilación ni proceso se ejecuta sobre él hasta que lo marques como confiable. Consulta la [guía de gO Studio](docs/GO-STUDIO.md).

### Entiende tu código

Análisis estático basado en la información de tipos de Go, sin ejecutar el código:

- **Architecture Explorer:** grafo de imports, llamadas entre paquetes, grafos de llamadas alrededor de cualquier función, puntos de entrada y servicios — `main`, rutas HTTP, servicios gRPC, productores y consumidores Kafka — y acceso a datos por tabla para database/sql, sqlx, pgx y GORM.
- **Rutas REST desde el código:** grupos de rutas, handlers, middleware y DTO de solicitud/respuesta, con las acciones *Open in API Client*, *Mock*, *Copy cURL* y *OpenAPI* sobre cada ruta.
- **Interface Explorer** y **Error Handling Intelligence:** implementaciones y casi-implementaciones, errores ignorados o sombreados, `%v` en lugar de `%w`, `==` en lugar de `errors.Is`.
- **Propagación del contexto:** sigue `context.Context` entre paquetes y señala las funciones que lo pierden.
- **Documentación:** cada paquete tal como lo muestra `go doc`, servicios y mensajes `.proto`, diagramas Mermaid en Markdown y ADR de `docs/adr`.

### Medir y reforzar

- **Performance Studio:** perfiles pprof desde los tests o directamente desde `/debug/pprof` de un servicio en marcha, flame graph, grafo de llamadas y coste por línea en el margen del editor; informes exportables en Markdown para un asistente de IA.
- **Go Trace:** trazas de ejecución leídas localmente con el propio parser de Go — goroutines, GC, latencia del planificador y bloqueos.
- **Benchmarks y fuzzing:** compara benchmarks con la ejecución anterior, con `main` o con cualquier commit; el Fuzzing Studio lista targets y corpus, reproduce entradas y convierte los fallos en tests.
- **Cobertura:** cobertura en el margen, cobertura del parche y el total comparado con la rama base en un worktree temporal.
- **Seguridad:** hallazgos de `govulncheck` ordenados por alcanzabilidad con rutas de llamada, y un análisis de código sin conexión para secretos incrustados, TLS y criptografía débiles y riesgos de inyección.

### IA en el editor

GitHub Copilot, [milk](https://github.com/scoutme/milk) (enrutado de agentes cheap/deep sobre ACP) y el asistente a0 están junto al editor y reciben el archivo abierto, cambios sin guardar incluidos. Las acciones del clic derecho explican código y errores, generan tests, benchmarks, targets de fuzzing y documentación, y buscan riesgos de carreras y fugas de goroutines. *Analyze failure* convierte un test fallido en un prompt revisable con su salida y el comando para reproducirlo. Las acciones de bases de datos y Kafka leen el esquema y los topics reales del proyecto. `.adomnia/aiignore` y la política de IA del proyecto deciden lo que nunca sale de la máquina.

### Del código al runtime

Inicia un servicio con Run o Debug y se convierte en una [Live Development Session](docs/LIVE-SESSION.md):

- **Debug Request** inicia el servicio con Delve si hace falta, espera a su puerto, envía la solicitud y se detiene en tu breakpoint, con el código y la solicitud uno al lado del otro.
- **Solicitud ↔ handler:** el API Workspace muestra el handler de Go que atiende una solicitud; un CodeLens sobre el handler lo abre, lo ejecuta o lo depura.
- **Todo lo que tocó una solicitud:** las consultas SQL (con tiempos, número de filas, sentencias lentas y avisos de N+1), los mensajes Kafka y las líneas de log que provocó una solicitud aparecen junto a su respuesta.
- **Enriquecimiento en runtime:** gO Studio superpone lo que realmente se ejecutó — rutas, fuentes de datos, topics, latencia, errores — sobre el mapa estático de dependencias.

## Herramientas de API y runtime

![API Workspace](docs/screenshots/api-light.png)

| Área | Resumen |
| --- | --- |
| **Cliente API** | REST y GraphQL, entornos y variables, OAuth 2.0, AWS Signature v4, Digest y más, scripts pre/post, aserciones, historial, generación de código; importación desde Postman, Insomnia, Bruno, cURL y OpenAPI; un editor OpenAPI con reglas de gobernanza. |
| **Tests y flujos** | Ejecutor de colecciones con datasets CSV, flujos grabados o asistidos por IA, variables extraídas, ramas de fallo, comprobaciones de contrato y pruebas de carga de flujos. |
| **Protocolos y brokers** | SOAP/WSDL con WS-Security, gRPC (incluido streaming), WebSocket, SSE, Kafka, RabbitMQ, MQTT, Redis Pub/Sub y NATS. |
| **Mocks y tráfico** | Mocks basados en esquemas, expectativas condicionales, grabar/reproducir, interceptación HTTPS con breakpoints y map local/remote, limitación de ancho de banda, pruebas de carga HTTP/gRPC y un laboratorio Docker local. |
| **Depuración** | Depuración de navegador mediante Chrome DevTools Protocol, inspector de logs de aplicación, visor HAR, diagnóstico de red y exportación de evidencias con datos ocultos. |
| **Datos y documentos** | Exploradores de SQLite, PostgreSQL, MySQL y MongoDB; Markdown, Mermaid y LaTeX; anotación de PDF, formularios y firmas digitales. |
| **Git** | Clonado, staging, commits, grafo del historial, ramas, merge, push/pull, resolución de conflictos y colecciones exportadas a una estructura de carpetas revisable. |
| **IA y MCP** | Modelos en la nube o locales opcionales, el asistente a0, GitHub Copilot y milk en gO Studio, un gateway local para agentes, un cliente MCP y un generador de servidores MCP. |
| **Seguridad y personalización** | Bóveda cifrada, entornos privados, herramientas de certificados, plugins JavaScript y WASI en sandbox (opcionalmente firmados), plantillas, temas y un color de acento personal. |

El [catálogo de funciones](docs/adomnia-feature-catalog.en.md) describe cada módulo.

## IA

Las funciones de IA son opcionales y permanecen desactivadas hasta que configures un proveedor en **Settings → AI Engine**. Proveedores compatibles: Anthropic, Amazon Bedrock, OpenAI, Google Gemini, DeepSeek, Hugging Face, Ollama y endpoints compatibles con OpenAI.

Las claves se leen de variables de entorno (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `HF_TOKEN`, `ADOMNIA_AI_API_KEY`…), de los entornos de adOmnia o de archivos `.env`, con la bóveda cifrada como alternativa. Amazon Bedrock usa la cadena estándar de credenciales de AWS. Los archivos listados en `.adomnia/aiignore` y los secretos detectados en el código nunca se envían.

## Datos y privacidad

- Sin cuenta, sin telemetría, sin sincronización automática en la nube.
- La edición y la inspección funcionan sin conexión; el tráfico de red va solo a los endpoints que tú llamas.
- Los proveedores de IA en la nube reciben solo el prompt y el contexto que aportas; Ollama u otro endpoint local mantiene la inferencia en tu máquina.
- El almacenamiento local no está cifrado por defecto: guarda los secretos en la **bóveda cifrada**. Los entornos privados se excluyen de las exportaciones.

## Línea de comandos y CI

El ejecutable de escritorio también funciona sin interfaz.

```bash
# Ejecutar una colección y escribir un informe JUnit
adomnia run ./my-collection --env prod --folder "Smoke" --reporter junit --out report.xml --bail

# Prueba de carga de un flujo exportado desde el panel Flow Stress
adomnia stress ./checkout.stress.json --dataset users.csv --reporter junit --out stress.xml

# Validar un documento OpenAPI
adomnia lint ./openapi.yaml --reporter json --out lint-report.json
```

Las solicitudes, aserciones o umbrales fallidos devuelven un código de salida distinto de cero.

<details>
<summary>Entornos y credenciales en ejecuciones sin interfaz</summary>

- `--env <nombre>` carga `environments/<nombre>.json`; `--env-var CLAVE=VALOR` sobrescribe una sola variable.
- Precedencia: variables de la colección, `.env` de la colección, entorno con nombre, valores de la CLI.
- Compatible: grants OAuth no interactivos, AWS Signature v4, un cookie jar por ejecución y subidas multipart.
- OAuth interactivo (authorization code/PKCE) requiere la aplicación de escritorio.
- Las referencias a la bóveda se resuelven desde variables de entorno `ADOMNIA_VAULT_<NOMBRE_DE_VARIABLE>`.

</details>

## Capturas de pantalla

<details>
<summary>Apariencias clara y oscura</summary>

![El Hub en la apariencia clara](docs/screenshots/hub-light.png)

![API Workspace en la apariencia oscura](docs/screenshots/api-dark.png)

</details>

## Compilar desde el código fuente

Requisitos: Go 1.26.5, Node.js 22.13.0 o posterior, la CLI de Wails 3 y los paquetes de desarrollo WebView de la plataforma.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git
cd adOmnia
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28
npm --prefix frontend ci
wails3 task dev
```

Compilación de producción y empaquetado:

```bash
wails3 task build
wails3 task package
```

Comprobaciones:

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run check:startup
go vet ./...
go test ./...
```

Consulta la [guía de compilación](docs/BUILD.md) para las dependencias nativas y los metadatos de versión.

## Documentación

La documentación detallada está en inglés.

| Documento | Contenido |
| --- | --- |
| [Instalación](docs/INSTALL.md) | Descargas y configuración por plataforma |
| [Compilación](docs/BUILD.md) | Toolchain, dependencias nativas, empaquetado |
| [Catálogo de funciones](docs/adomnia-feature-catalog.en.md) | Referencia módulo por módulo |
| [gO Studio](docs/GO-STUDIO.md) | Uso del IDE de Go, modelo de confianza, herramientas, atajos |
| [Live Development Session](docs/LIVE-SESSION.md) | Código ↔ servicio en ejecución ↔ solicitud API |
| [Arquitectura](docs/ARCHITECTURE.md) | Estructura de la aplicación |
| [FAQ](docs/FAQ.md) · [Solución de problemas](docs/TROUBLESHOOTING.md) | Preguntas frecuentes y recuperación |
| [Changelog](CHANGELOG.md) · [Proceso de publicación](docs/RELEASE.md) | Cambios por versión y publicación |

## Contribuir

Informa de errores y propón cambios en [GitHub Issues](https://github.com/Andrea-Cavallo/adOmnia/issues), indicando la versión de la aplicación, el sistema operativo y los pasos para reproducirlo. Elimina credenciales y datos privados de los ejemplos. Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar código, e informa de vulnerabilidades de forma privada como se describe en la [política de seguridad](.github/SECURITY.md).

Gracias a [albertize](https://github.com/albertize) y [plunix](https://github.com/plunix) por sus contribuciones.

## Licencia

[MIT](LICENSE.md) · Copyright © 2027 Andrea Cavallo
