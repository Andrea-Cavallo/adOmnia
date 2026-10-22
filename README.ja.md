<p align="center">
  <img src="assets/images/banner.png" alt="adOmnia" width="100%">
</p>

<p align="center">
  <strong>AI エージェントが書いたコードを実行・テスト・デバッグする、ローカルファーストのデスクトップ IDE。</strong><br>
  ルート、API クライアント、Delve デバッガ、データベース、ブローカーを 1 つのウィンドウに。アカウント不要、クラウド不要、テレメトリなし。
</p>

<p align="center">
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest">ダウンロード</a> ·
  <a href="https://www.youtube.com/watch?v=tefwLUadRr8">デモを見る</a> ·
  <a href="docs/GETTING-STARTED.md">はじめに</a> ·
  <a href="docs/QUICKSTART.it.md">イタリア語ガイド</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.es-ES.md">Español</a> · <strong>日本語</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest"><strong>Windows 版をダウンロード (.exe)</strong></a> ·
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest"><strong>macOS 版をダウンロード (.dmg)</strong></a> ·
  <a href="https://github.com/Andrea-Cavallo/adOmnia/releases/latest"><strong>Linux 版をダウンロード (.tar.gz)</strong></a>
</p>

## スクリーンショット

### Workspace Hub

メインのワークスペースから始めて、最近のアクティビティを確認し、必要な領域を開きます。Code Studio、API とプロトコル、データとメッセージング、ドキュメント、バージョン管理、各種ツールに移動できます。

<p align="center">
  <img src="assets/images/ado-hub.png" alt="モジュールへのショートカットと最近のアクティビティを表示した adOmnia Workspace Hub" width="100%">
</p>

### Code Studio

Go サービスの編集と実行を、プロジェクトツリー、ソースエディタ、ターミナル、状況に応じた AI アシスタントを同じワークスペースに表示したまま行えます。

<p align="center">
  <img src="assets/images/ado-ide.png" alt="Go プロジェクト、ソースエディタ、実行中のサービス、Claude Code パネルを表示した Code Studio" width="100%">
</p>

### API Workspace

リクエストをコレクションに整理し、実行中のサービスに送信してレスポンスを確認できます。認識されたルートは、対応する Go ハンドラに直接リンクします。

<p align="center">
  <img src="assets/images/ado-api.png" alt="ヘルスチェックのリクエスト、レスポンス、Go ハンドラへのリンクを表示した API Workspace" width="100%">
</p>

### Database Studio

SQLite、PostgreSQL、MySQL、MongoDB、Redis に接続し、クエリの作成、結果・キー・履歴の確認をアプリから離れずに行えます。

<p align="center">
  <img src="assets/images/ado-db.png" alt="Redis に接続し、JSON コマンドエディタとキーエクスプローラを表示した Database Studio" width="100%">
</p>

### Git Sync

ブランチとコミット履歴の確認、変更ファイルのレビュー、選択した変更のステージング、リポジトリビューからの fetch・pull・push・stash の実行ができます。

<p align="center">
  <img src="assets/images/ado-git.png" alt="リポジトリのブランチ、コミットグラフ、作業中の変更を表示した Git Sync" width="100%">
</p>

## デモ

**[▶ YouTube でデモを見る](https://www.youtube.com/watch?v=tefwLUadRr8)**

*リクエスト、そのレスポンス、関連する Go ハンドラを表示した API Workspace。画像を選択するとデモを再生できます。*

## API 開発とサービスのデバッグ

adOmnia は API テストと Go 開発を組み合わせたツールです。リクエストは検出されたハンドラにリンクでき、実行中のサービスに対して実行し、デバッガで調査できます。データベース、メッセージング、ログ、トレースの各ツールも同じアプリに入っています。キャプチャを設定すると、実行中のリクエストに関連する SQL、メッセージ、ログを追跡できます。

**Code Studio** で起動した Go サービスは **ライブ開発セッション** になります。**API Workspace** からそれを呼び出してデバッグでき、認識されたルートからソースへ戻れます。ログと、設定済みの SQL/ブローカーのキャプチャも同じワークフローの一部です。

```text
書く               実行する            呼び出す              理解する
Code Studio    →    ライブサービス   →    API Workspace    →    ハンドラ / ブレークポイント
                                                                ↕
                                                    変数 · ログ · SQL · メッセージ
```

### 主な機能

| 機能 | 説明 |
| --- | --- |
| **API テストとソースへの移動** | 再利用できるコレクション、環境、認証、アサーション。認識された Go ハンドラへ直接移動できます。API から始めて、実行中のコードの実装まで追えます。 |
| **リクエスト起点のデバッグ** | Debug Request は互換性のある Delve セッションを起動または再利用します。フレーム、変数、goroutine を調べ、ハンドラをステップ実行してレスポンスに戻れます。 |
| **リクエストの隣にデータとイベント** | Database、Broker、Log、Trace の各ツールを同じアプリで使えます。キャプチャを設定すると、実行中のリクエストに関連する SQL、メッセージ、ログを追跡できます。 |
| **Go 開発とプロファイリング** | gopls による編集とナビゲーション、テスト/カバレッジのワークフロー、Delve、pprof、実行トレース、アーキテクチャ/影響範囲ビューが、ソースレベルの作業と実行時の調査をつなぎます。 |
| **同じワークフローでエンタープライズ向けプロトコル** | HTTP、SOAP/WSDL、WS-Security、gRPC、WebSocket/SSE、mTLS、証明書ツールが、最新の API と既存システムの両方を支えます。 |
| **レビュー付きの修正による依存関係のセキュリティ** | Security Center は `pom.xml` と `go.mod` をスキャンし、深刻度と悪用の兆候を分けて扱い、アップグレード前にセキュリティへの影響をプレビューします。安全な修正では差分を表示し、チェックを実行し、あなたのレビュー後にのみ適用します。 |
| **ローカル保存と複数ウィンドウ** | ローカルのコレクションと設定、エクスポート可能なデータ、複数の Go プロジェクト、ネイティブのスタジオウィンドウ。IDE、API クライアント、補助ツールを複数のウィンドウに配置できます。 |

### ストレージと外部サービス

**アプリの利用にアカウントは不要です。** コレクション、設定、プロジェクトの状態はローカルに保存されます。接続する API、データベース、ブローカー、任意の AI プロバイダはあなたが選びます。外部プロバイダとローカルサービスは、明示的に選択したものだけが使われます。

### プロジェクトとウィンドウ

サービスは Code Studio に、リクエストは API Workspace に、データベースやブローカーはその隣に置けます。別の Go プロジェクトを、同じ adOmnia のインスタンスの中で専用のネイティブウィンドウに開けます。

ワークフローは、プロジェクト、サービスセッション、API リクエスト、利用可能な診断情報の間のつながりを保ちます。

## API から始める

1. **API Workspace** を開き、コレクションとリクエストを作成します。
2. メソッドと URL を選び、**Body**、**Headers**、**Params**、認証を設定します。
3. `{{baseUrl}}` のような再利用する値のために環境を選びます。
4. **SEND** を押します。ステータス、所要時間、レスポンスボディ、ヘッダー、テスト結果を確認します。
5. リクエストを保存して再実行するか、エクスポートを共有します。

API ツールは Go プロジェクトを開かなくても使えます。

| ワークフロー | 同じワークスペースにあるツール |
| --- | --- |
| HTTP API のテスト | コレクション、環境、認証、レスポンスの確認、アサーション |
| エンタープライズ向けプロトコル | SOAP/WSDL、WS-Security、gRPC、mTLS、証明書ツール |
| ライブ接続の追跡 | WebSocket と SSE のクライアント |
| レスポンスの再現 | モックサーバーとプロキシ/インターセプターのツール |
| サービスデータの確認 | Database Studio と Broker Studio |
| 障害の原因の理解 | ブラウザデバッグ、ログ、トレース、接続された Go デバッガ |

## リクエストから Go コードへ

1. **Code Studio → File → Open Project** でサービスを開きます。
2. フォルダを信頼して Go ツールを有効にします。SDK と Run/Debug の構成を設定します。
3. ハンドラにブレークポイントを置いてデバッグを開始するか、API リクエストのアクションから **Debug Request** を使います。
4. 対応するリクエストを送信します。認識されたルートでは、**HANDLER** ストリップの **OPEN IN GO IDE** からソースへ移動できます。
5. 停止したフレーム、変数、スタック、goroutine を確認します。ステップ実行または続行して、レスポンスに戻ります。

キャプチャ/インストルメンテーションを設定すると、SQL、ブローカーのメッセージ、ログがこのワークフローを補強します。すべてのサービスで自動的に使えるわけではありません。最初のセットアップは[ウォークスルー](docs/GETTING-STARTED.md)を参照してください。

## Code Studio: ワークフローの中にある IDE

![ライトテーマの Code Studio。ブレークポイントで停止し、goroutine と変数を表示している](docs/screenshots/go-debug-light.png)

*ブレークポイントで停止した Code Studio。ソースコード、goroutine、変数、コンソール出力を表示しています。コントロールはリリースによって異なる場合があります。*

- **編集とナビゲーション:** gopls による補完、診断、参照、リネーム、リファクタリング、プロジェクト検索、Git。
- **実行、テスト、デバッグ:** Go の構成、テストエクスプローラ、カバレッジ、条件付きブレークポイントと goroutine の確認ができる Delve。
- **Go 以外の言語:** TypeScript/JavaScript と Web プロジェクト（Vite/npm スクリプト、Vitest/Jest の結果、Live Preview）、および Java（Maven/Gradle、JUnit、Spring Boot、ブレークポイントとリモートアタッチ）が、同じ実行・テスト・デバッグの画面を使います。`pom.xml` では、Maven Central の新しいバージョンの確認と、既知の脆弱性に対する依存関係のスキャンができ、ワンクリックでバージョンを更新できます。言語サーバーとデバッガは、実行されるコマンドを確認して承認した後にのみインストールされます。
- **プロジェクトを理解する:** ルート、依存関係、インターフェース、アーキテクチャ、変更の影響範囲のビュー。
- **挙動を計測する:** pprof プロファイル、実行トレース、ベンチマーク、並行処理のツール。
- **作業をまとめて保つ:** ターミナル、ローカル履歴、復旧用スナップショット、1 つの adOmnia インスタンス内の複数のプロジェクト/ウィンドウ。
- **AI アシスタンス:** 設定したプロバイダとプロジェクトのポリシーに基づく状況に応じた支援。変更は適用する前にレビューしてください。

プロジェクトセレクタから別のプロジェクトを開けます。**Open Project in New Window** を選ぶと最初の IDE の隣に配置できます。移動する前に、未保存のファイルを保存または破棄してください。周辺のツールとワークスペースには **Studios** メニューを使います。

[Code Studio ガイドを読む →](docs/CODE-STUDIO.md) · [技術リファレンス: IDE プラットフォーム →](docs/CODE-STUDIO-REFERENCE.md)

## 2 分で試す

1. adOmnia をダウンロードして起動します。
2. **Code Studio** で **File → Open Project** を選び、Go サービスを開きます。フォルダを信頼します。
3. `Ctrl+K` を押して、ルートを検索します。
4. **Debug Request** を選び、ハンドラにブレークポイントを置きます。
5. サービスが Delve の下で起動し、リクエストが送信され、ブレークポイントで停止します。

## ダウンロードとインストール

adOmnia は **[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)** から入手できます。利用可能なアセットと既知の制限は、リリースページで確認してください。

| プラットフォーム | ダウンロード | セットアップ |
| --- | --- | --- |
| Windows x64 | [`adomnia-<version>-windows-amd64.exe`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) | WebView2 が必要。実行ファイル/ユーザー単位のインストールで、MSI ウィザードではありません |
| macOS Intel / Apple Silicon | [`adomnia-<version>-macos-universal.dmg`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) | DMG からインストール。署名の詳細はリリースノートを確認してください |
| Linux x64 | [`adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) | GTK 3 と WebKitGTK 4.1 が必要 |

**初回起動（OS 署名なしのバイナリ）:** Windows では SmartScreen が表示されたら **詳細情報 → 実行** を選びます。macOS では初回のみアプリを右クリックして **開く**、または `xattr -dr com.apple.quarantine /Applications/adomnia.app` を実行します。アプリ内アップデータは独自の署名とチェックサムを検証します。

更新の確認は **Settings** から行えます。更新パッケージは発行元の署名とチェックサムを検証し、インストール時には確認を求めます。OS のコード署名は、アップデータのパッケージ署名とは別のものです。

[インストールと更新](docs/INSTALL.md) · [リリースノートとサポートの制限](docs/releases/v1.0.0.md)

## 実験的な機能

LAN コラボレーションは **ベータ版で、オプトイン** です。単体の LaTeX、Kubernetes/OpenShift、プラグインマーケットプレース、Hub のゲームは、v1 のナビゲーションでは非表示です。インポートした PDF は引き続き完全な PDF エディタで開きますが、対応状況は基盤となる OS とツールチェーンに左右されます。

## ドキュメント

| まずはこちら | できること |
| --- | --- |
| [はじめに](docs/GETTING-STARTED.md) · [イタリア語ガイド](docs/QUICKSTART.it.md) | リクエストの送信、Go プロジェクトの接続、ハンドラのデバッグ |
| [インストール](docs/INSTALL.md) | インストール、更新、プラットフォーム要件の確認 |
| [Code Studio](docs/CODE-STUDIO.md) | プロジェクト、ツール、テスト、デバッガ、エディタの設定 |
| [Code Studio 技術リファレンス](docs/CODE-STUDIO-REFERENCE.md) | IDE プラットフォーム（アーキテクチャ、モジュール、言語アダプタ、UI、バインディング）の理解 |
| [ライブセッション](docs/LIVE-SESSION.md) | リクエストとコード、ログ、SQL、メッセージの接続 |
| [機能リファレンス](docs/adomnia-feature-catalog.en.md) | 周辺のスタジオの確認 |
| [トラブルシューティング](docs/TROUBLESHOOTING.md) · [FAQ](docs/FAQ.md) | セットアップやワークフローの問題の解決 |
| [ソースからのビルド](docs/BUILD.md) · [コントリビュート](CONTRIBUTING.md) | アプリのビルドとコントリビュート |

## フィードバックとコントリビューション

バージョン、オペレーティングシステム、再現手順を添えて[問題を報告](https://github.com/Andrea-Cavallo/adOmnia/issues)してください。スクリーンショットやエクスポートからは、認証情報と個人データを取り除いてください。プルリクエストを開く前に、リポジトリのコントリビューションガイドラインに従ってください。

[MIT ライセンス](LICENSE.md)
