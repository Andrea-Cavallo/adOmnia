# FAQ

## Is adOmnia cloud-based?

No. adOmnia is local-first. It does not require an account, telemetry, or cloud sync.

## Where is my data stored?

Locally, using a mix of bbolt, localStorage, local files, and exported `.adomnia` workspace files.

## Does adOmnia collect telemetry?

No.

## Can I download the app without building from source?

Yes. Download stable builds from GitHub Releases, or CI builds from Actions artifacts.

## Which files should I download?

- Windows: `adOmnia-<version>-windows-amd64.exe`
- Linux: `adOmnia-<version>-linux-amd64.tar.gz` or the standalone Linux binary
- macOS: `adOmnia-<version>-macos-universal.dmg`

## Is the app code-signed?

Not yet by default. Windows and macOS may show warnings for unsigned development builds.

## Does it replace Postman?

It aims to cover HTTP API workflows and extend beyond them with local-first behavior, browser debugging, brokers, SOAP/WSDL, proxy, mock, database, and enterprise tooling.

## Can it import Postman, Insomnia or Bruno collections?

Yes. adOmnia imports Postman (v2.1), Insomnia (v4 export) and Bruno (JSON and `.bru` files), and it can export back to the same formats. OpenAPI 3 and Swagger 2 documents are also imported as collections. Drop a file anywhere in the app or use the collection toolbar import button.

## Are secrets encrypted?

Vault data is intended for encrypted secrets. Ordinary collections and environment fields outside the Vault may be stored unencrypted. Use the Vault for sensitive values.

## Does Docker have to be installed?

No for ordinary use. Docker is only needed for Docker Lab workflows or local Linux artifact builds.

## How do I report a vulnerability?

Do not open a public issue. Follow [.github/SECURITY.md](../.github/SECURITY.md).
