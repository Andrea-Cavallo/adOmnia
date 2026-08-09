

# adOmnia
![banner de adOmnia](assets/images/banner.png)

**La cadena de herramientas API completa — desde REST hasta Kafka, desde mocks hasta proxy MITM, desde bases de datos hasta firma de PDF — en una sola aplicación portátil que nunca abandona tu máquina.**

REST · gRPC · SOAP · GraphQL · WebSocket · SSE · Kafka · RabbitMQ · MQTT · Redis · NATS
Servidores mock · Proxy HTTPS · DevTools para navegador · Pruebas de carga · Database Studio · Bóveda cifrada
**Cliente Git completo** (grafo de commits, push/pull, ramas y resolución de conflictos) · Diseño OpenAPI · Constructor visual de pruebas · Generación de mocks con IA
Cliente MCP + Generador de servidor · Carpetas de colecciones versionables · Ejecutor headless · CLI de lint OpenAPI · Estudio PDF y LaTeX · Plugins WASM + JS · 11 temas

> **Deja de pagar una suscripción para enviar una solicitud HTTP.** Sin cuenta. Sin cloud. Sin telemetría. Un único ejecutable, **más de 507 funciones**, tus datos siguen siendo tuyos.

> Orgullosamente listado en **[Awesome Wails](https://github.com/wailsapp/awesome-wails)** y **[Awesome HTTP Clients](https://github.com/mrmykey/awesome-http-clients/tree/main)**.

[![Website](https://img.shields.io/badge/Get%20started%20for%20free-8A2BE2)](https://www.adomnia-dev.com)
[![Awesome Wails](https://img.shields.io/badge/Awesome-Wails-FF3E00?logo=go&logoColor=white)](https://github.com/wailsapp/awesome-wails)
[![Awesome HTTP Clients](https://img.shields.io/badge/Awesome-HTTP_Clients-4285F4?logo=googlechrome&logoColor=white)](https://github.com/mrmykey/awesome-http-clients/tree/main)
![Local First](https://img.shields.io/badge/local--first-yes-22c55e)
![No Telemetry](https://img.shields.io/badge/telemetry-none-0ea5e9)
![License](https://img.shields.io/badge/license-MIT-blue)

---

![interfaz de adOmnia](assets/images/adOmniaInterface1.png)

o tema claro:

![interfaz de adOmnia en tema claro](assets/images/white.png)

### ¿Por qué adOmnia?

La mayoría de las herramientas API fueron por el camino equivocado: trasladaron tus solicitudes, secretos e historial a la nube de otra persona, pusieron a tu equipo detrás de un muro de inicio de sesión y te cobraron mensualmente por ello. adOmnia es la apuesta opuesta — **una aplicación de escritorio rápida que hace más que las suites en la nube, manteniendo todo en tu máquina.**

Reemplaza a una estantería entera de herramientas:

> **Postman + Insomnia + Charles/Fiddler + DevTools del navegador + un cliente de base de datos + una herramienta SOAP/WSDL + un probador de carga + un gestor de secretos + un firmante de PDF** — todo colapsado en un único ejecutable portátil que nunca se comunica con servidores externos.

Cuatro cosas lo diferencian, y **ninguna otra herramienta combina las cuatro**:

-  **Primero lo local, de verdad** — sin cuenta, sin telemetría, sin sincronización en la nube. Tus colecciones, secretos y tráfico nunca abandonan tu disco. Los espacios de trabajo permanecen locales, las colecciones se pueden exportar como árboles de carpetas deterministas y un **cliente Git integrado** (grafo visual de commits, ramificación/fusión, push/pull, resolución de conflictos) las versiona sin salir nunca de la aplicación.
-  **Depuración del navegador integrada** — inspecciona y depura páginas web reales (red, consola, depurador de JS, DOM, almacenamiento) *dentro* de la misma herramienta con la que pruebas APIs. Ningún competidor lo hace.
-  **Entorno empresarial y sistemas legacy como ciudadanos de primera clase** — SOAP/WSDL con WS-Security, mTLS, PKCS#12/JKS, streaming de gRPC y **firmas digitales de PDF reales de grado eIDAS** (marcado de tiempo TSA + LTV). Las cosas aburridas pero críticas que Postman ignora.
-  **Tuyo para extender** — plugins WASM/JS, temas importables, plantillas compartibles y 11 temas integrados.

probar APIs REST:

![adOmnia rest](assets/images/REST.png)

### ⬇️ Descarga

**[→ Ir a Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)** y descarga el archivo para tu plataforma. Sin instalación, sin dependencias.

| Plataforma | Archivo |
|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` |
| macOS | `adOmnia-*-macos-universal.dmg` |
| Linux (GTK 3 / WebKitGTK 4.1) | `adOmnia-*-linux-amd64-gtk3-webkitgtk-4.1.tar.gz` |

Todos los lanzamientos incluyen `SHA256SUMS.txt` y archivos de código fuente. Verifica tu descarga con las sumas de verificación publicadas.

### Lo que obtienes: más de 507 funciones en 11 áreas

| Área | Lo que obtienes |
|---|---|
| **Espacio de trabajo API** | Múltiples espacios de trabajo locales con colecciones y pestañas independientes, cliente HTTP (todos los métodos), entornos, sustitución de `{{variable}}`, OAuth2 PKCE, AWS Signature v4, Digest, importación cURL/OpenAPI, scripts, aserciones, generación de código, historial de respuestas, exportación/importación determinista de carpetas de colecciones |
| **Diseño API (primero la especificación)** | Importación nativa de OpenAPI 3.x / Swagger 2.x (archivo/URL/pegar) y exportación bidireccional (JSON/YAML), **Editor visual de OpenAPI** (puntos finales basados en formularios, sin YAML), **Visor de documentación API / Swagger** con hallazgos de gobernanza integrados, linting local de OpenAPI en la interfaz de escritorio y CI |
| **Catálogo API** | Iniciadores públicos de API REST instalables, incluyendo puntos finales curados sin autenticación/gratuitos inspirados en `public-apis/public-apis`, importados directamente en colecciones locales de adOmnia |
| **Ejecutor de colecciones y pruebas** | Ejecutor de pruebas con iteraciones/retraso/reintento/conjuntos de datos CSV, editor de aserciones (JSONPath, XPath, esquema), flujos API generados por Mermaid, **constructor de pruebas visuales sin código** (basado en bloques, exportar a Flow), **validación de esquema/contrato de respuesta**, estudio de datos de prueba y un `adomnia run` CLI headless para colecciones respaldadas por carpetas con informes CLI/JSON/JUnit |
| **Protocolos** | Estudio SOAP/WSDL (1.1 y 1.2, WS-Security), gRPC (reflexión, autoría offline de proto/protoset, llamadas unarias, streaming cancelable en vivo, TLS/mTLS, metadatos, trailers, historial reproducible y pruebas de carga), cliente WebSocket + servidor mock, cliente SSE, **Cliente/Depurador MCP** + **Generador de servidor MCP** (colección/OAS → servidor MCP ejecutable; transporte stdio multi-sesión + HTTP) |
| **Brokers** | Kafka (produce/consume/a lote/prueba de carga), RabbitMQ, MQTT, Redis Pub/Sub, NATS — registro de mensajes compartido, perfiles de conexión persistentes |
| **Simulación e infraestructura** | Sala de control del servidor mock con **Motor de mock inteligente** (generación Faker impulsada por esquema), **expectativas condicionales** (coincidencia por campo), entrega enfocada en la solicitud **pestaña Mock this**, explorador de puntos finales, tráfico consciente de decisiones, grabar y reproducir y round-robin; proxy HTTPS/interceptor (CA MITM, puntos de interrupción, mapeo local/remoto, limitación), Laboratorio Docker (14 preset), pruebas de carga (HTTP + gRPC, histograma HDR, P99, comparación lado a lado) |
| **Depuración y análisis** | DevTools del navegador vía CDP (red, consola, depurador JS, inspector DOM, almacenamiento, capturas de pantalla), visor HAR, búsqueda/trace/comparación DNS, escáner de puertos, probador CORS, herramientas JSON/XML/YAML, panel de observabilidad, escáner de secretos |
| **Estudio de documentos y productividad** | **Editor PDF** (ver, anotar, llenar formularios, aplanar/exportar) con **firma criptográfica real**: importación de almacén de claves PEM o PKCS#12/JKS, **marcado de tiempo TSA** RFC-3161 y **LTV** (cadena + OCSP/CRL); **Estudio LaTeX** (editor `.tex` en vivo + vista previa + plantillas); estudio Markdown; diagramas Mermaid |
| **Control de versiones (Git integrado)** | Cliente Git completo dentro de la aplicación: clonar/inicializar, preparar y commit, **grafo visual de commits** con acciones de contexto por commit (checkout, revertir, reset, cherry-pick), crear/cambiar/fusionar ramas, push/pull a cualquier remoto, visor de diferencias y **resolución interactiva de conflictos**. Exportar colecciones como árboles respaldados por carpetas y compatibles con diff, importarlos de nuevo y verificar desviación entre el estado de la aplicación y los archivos en disco |
| **Datos, seguridad y extensibilidad** | Estudio de base de datos (SQLite/PostgreSQL/MySQL/MongoDB), inspector de almacenamiento bbolt, bóveda cifrada (age/scrypt), **motor de IA** (Anthropic/OpenAI/Gemini/Ollama — generación de mocks con IA) con credenciales del Vault o del entorno local de la máquina, sandbox de plugins WASM/JS, 11 temas integrados + sistema de temas personalizados |

### Simular la solicitud en la que estás trabajando

Desde una pestaña de solicitud abierta, elige **Simular esta pestaña**. adOmnia abre el servidor mock directamente en ese punto final en un ámbito enfocado: las definiciones mock existentes permanecen guardadas, pero solo la solicitud seleccionada está activa hasta que elijas **Mostrar todos los puntos finales**. Si el servidor ya está en ejecución, la configuración enfocada se aplica en vivo sin cambiar su puerto.

La vista de Tráfico explica qué ocurrió en cada llamada: el punto final y la respuesta coincidentes, o una razón útil como falta de respuesta mock, fallo de autenticación, preflight CORS o ninguna ruta coincidente.

### Credenciales de IA desde la máquina local

En **Configuración → Motor de IA**, activa **Usar credenciales del entorno del sistema** para omitir el Vault en las conexiones de IA. El backend de escritorio lee la clave solo desde el entorno heredado por adOmnia; nunca se devuelve a la interfaz ni se guarda en la configuración.

Las variables admitidas incluyen `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `HUGGINGFACE_API_KEY` / `HF_TOKEN`, `OPENAI_COMPATIBLE_API_KEY` y la genérica de respaldo `ADOMNIA_AI_API_KEY`. En Windows, reinicia adOmnia después de cambiar una variable de entorno de usuario o del sistema.

### Versionar colecciones como carpetas

adOmnia mantiene el espacio de trabajo de escritorio rápido y local, pero las colecciones también pueden proyectarse a un formato de carpeta simple para revisión, historial de Git y CI:

```text
adomnia.collection.json
collection.json
folders/
  001-auth/
    folder.json
    001-login.request.json
  002-users/
    001-list-users.request.json
.adomnia-sync.json
```

Desde **Git Sync → Carpeta de colección** puedes:

- exportar la colección seleccionada a un árbol de carpetas determinista
- importar una colección respaldada por carpetas al espacio de trabajo actual
- verificar la desviación entre la colección en la aplicación y los archivos en disco

Las colecciones respaldadas por carpetas también pueden incluir autenticación compartida, encabezados, variables y scripts a nivel de colección/carpeta. El ejecutor headless resuelve la autenticación, los encabezados y las variables de arriba hacia abajo para que los tokens bearer comunes, los encabezados de inquilino y las variables de CI no necesiten duplicarse en cada solicitud; los scripts se preservan en el formato de carpeta mientras la paridad de scripts headless está en progreso.

### Ejecutor headless

El mismo ejecutable de escritorio puede ejecutar colecciones respaldadas por carpetas sin abrir la interfaz:

```bash
adomnia run ./my-collection --env prod --folder "Smoke" --reporter junit --out report.xml --bail
```

Admitido actualmente:

- ejecución completa de la colección o con alcance a carpeta con `--folder`
- carga de `.env` local a la colección, ignorado por Git de forma predeterminada
- carga de archivos de entorno desde `environments/<name>.json` con `--env`
- anulaciones con `--env-var KEY=VALUE`; la prioridad son las variables de la colección, `.env`, entorno con nombre y luego la anulación de CLI
- informes en CLI, JSON y JUnit
- código de salida distinto de cero en caso de fallo de solicitud/aserción
- resolución compartida de solicitudes para variables, parámetros de ruta, valores de consulta/encabezado/cuerpo, autenticación simple y aserciones headless
- concesiones OAuth2 `client_credentials`, password y refresh-token, además de AWS Signature v4
- contenedor de cookies con alcance de ejecución, campos multipart y partes de archivo `@file:<path>` 
- scripts pre/post/prueba en sandbox con `pm.environment`, `pm.response`, `pm.test` y `pm.expect` 
- verificaciones de contrato de respuesta OpenAPI cuando la colección lleva un `openapiSpec` 
- referencias del Vault proporcionadas de forma segura en CI a través de variables de entorno `ADOMNIA_VAULT_<NOMBRE_VARIABLE>` 

La autenticación interactiva de OAuth sigue perteneciendo al flujo del navegador de escritorio. Las ejecuciones headless rechazan intencionalmente la interacción authorization-code/PKCE y dirigen a los usuarios a un token de actualización o a una concesión no interactiva. El texto cifrado del Vault nunca se descifra ni imprime por la CLI; la CI inyecta el valor en texto claro solo en la memoria del proceso a través de la variable coincidente `ADOMNIA_VAULT_*`.

Los entornos pueden marcarse como **Privados** en el editor de entornos. Los entornos privados permanecen en el almacenamiento local bbolt y se excluyen de las exportaciones de carpetas de colecciones y archivos de espacio de trabajo. Los secretos de entornos públicos se exportan únicamente como marcadores de posición vacíos.

En Git Sync, **Exportar** actualiza la carpeta completa determinista de la colección, mientras que **Solicitud** actualiza solo el archivo de solicitud abierto actualmente. La exportación incremental requiere una proyección de carpeta existente para que los nombres de archivo y el orden permanezcan estables.

### Lint OpenAPI en CI

Analiza con lint un archivo OpenAPI o una colección de adOmnia respaldada por carpetas que contenga un `openapiSpec` en `collection.json`:

```bash
adomnia lint ./openapi.yaml --reporter json --out lint-report.json
adomnia lint ./my-collection --ruleset adomnia.oaslint.json --fail-on-warn
```

Las reglas locales integradas verifican IDs de operación, resúmenes/descripciones, cobertura de respuestas, esquemas de respuesta JSON, etiquetas, requisitos de seguridad, nomenclatura de rutas y IDs de operación duplicados. Los hallazgos de tipo `error` devuelven un código de salida distinto de cero; las advertencias no bloquean la ejecución a menos que se establezca `--fail-on-warn`.

El mismo motor está disponible en **Documentación API > Gobernanza**. Muestra insignias de error/advertencia/info, hallazgos buscables, navegación por operaciones y un conjunto de reglas JSON local cuyas anulaciones se persisten solo en la máquina.

### Compilar desde el código fuente

Solo necesario si deseas compilarlo tú mismo. Requiere **Go 1.26.5+**, **Node.js 20+**
y la **CLI de Wails 3** (`wails3`). En Linux también necesitas `libgtk-3-dev` y
`libwebkit2gtk-4.1-dev`.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git && cd adomnia
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5
cd frontend && npm install && cd ..
wails3 task dev      # modo dev
wails3 task build    # compilación para producción en la plataforma actual
```

Instrucciones completas: [docs/BUILD.md](docs/BUILD.md)

### Licencia

MIT © Andrea Cavallo — [LICENSE.md](LICENSE.md).

---

Agradecimientos especiales a:
- https://github.com/albertize
- https://github.com/plunix
