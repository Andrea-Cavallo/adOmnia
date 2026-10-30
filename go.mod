module github.com/Andrea-Cavallo/adOmnia

go 1.27.3

require (
	filippo.io/age v1.3.2
	github.com/HdrHistogram/hdrhistogram-go v1.4.0
	github.com/IBM/sarama v1.61.1
	github.com/aws/aws-sdk-go-v2 v1.47.4
	github.com/aws/aws-sdk-go-v2/config v1.33.10
	github.com/aws/aws-sdk-go-v2/service/bedrock v1.74.1
	github.com/aws/aws-sdk-go-v2/service/bedrockruntime v1.63.5
	github.com/aymanbagabas/go-pty v0.2.3
	// Pinned: pdf v0.2.0 unexports Reader.Resolve, which pdfsign v0.9.0 still
	// calls. Unpin only together with pdfsign >= v1.0.0 (currently rc only).
	github.com/digitorus/pdf v0.1.2 // keep v0.1.x: pdfsign v0.9.0 calls Reader.Resolve, removed in v0.2.0
	github.com/digitorus/pdfsign v0.9.0
	github.com/dop251/goja v0.0.0-20261018113103-d42f16bb6161
	github.com/dustin/go-humanize v1.1.0
	github.com/eclipse/paho.mqtt.golang v1.5.1
	github.com/fsnotify/fsnotify v1.10.1
	github.com/gabriel-vasile/mimetype v1.4.16
	github.com/gaissmai/bart v0.30.0
	github.com/go-sql-driver/mysql v1.10.1
	github.com/google/pprof v0.0.0-20261016150608-1facf8f91b50
	github.com/gorilla/websocket v1.5.3
	github.com/jackc/pgx/v5 v5.11.0
	github.com/jhump/protoreflect v1.19.0
	github.com/miekg/dns v1.1.73
	github.com/nats-io/nats.go v1.54.0
	github.com/pavlo-v-chernykh/keystore-go/v4 v4.5.0
	github.com/rabbitmq/amqp091-go v1.16.0
	github.com/redis/go-redis/v9 v9.23.0
	github.com/romshark/jscan v1.2.0
	github.com/shirou/gopsutil/v4 v4.26.9
	github.com/tetratelabs/wazero v1.12.0
	github.com/tidwall/gjson v1.20.0
	github.com/tidwall/sjson v1.2.5
	github.com/wI2L/jsondiff v0.7.1
	github.com/wailsapp/wails/v3 v3.0.0-beta.34
	github.com/xdg-go/scram v1.2.0
	github.com/youmark/pkcs8 v0.0.0-20240726163527-a2c0da244d78
	github.com/zalando/go-keyring v0.2.8
	go.etcd.io/bbolt v1.5.0
	go.mongodb.org/mongo-driver/v2 v2.9.2
	go.opentelemetry.io/proto/otlp v1.11.1
	golang.org/x/exp v0.0.0-20261014143641-f0251eb4aa3e
	golang.org/x/mod v0.42.0
	golang.org/x/net v0.61.0
	golang.org/x/sys v0.49.0
	golang.org/x/tools v0.52.0
	google.golang.org/grpc v1.84.0
	google.golang.org/protobuf v1.36.12
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.60.1
	software.sslmate.com/src/go-pkcs12 v0.7.4
)

require (
	filippo.io/edwards25519 v1.2.0 // indirect
	filippo.io/hpke v0.4.0 // indirect
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.22 // indirect
	github.com/aws/aws-sdk-go-v2/credentials v1.20.10 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.20.4 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.5.7 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.8.7 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.5.7 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.22 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.14.7 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.10.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.38.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.43.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.51.5 // indirect
	github.com/aws/smithy-go v1.28.6 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/coder/websocket v1.8.15 // indirect
	github.com/creack/pty v1.1.24 // indirect
	github.com/danieljoos/wincred v1.2.3 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/digitorus/pkcs7 v0.0.0-20260914070511-d678ea5ea03f // indirect
	github.com/digitorus/timestamp v0.0.0-20260914073129-b4b58b92aa51 // indirect
	github.com/dlclark/regexp2/v2 v2.9.1 // indirect
	github.com/eapache/go-resiliency v1.7.0 // indirect
	github.com/ebitengine/purego v0.11.2 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/go-sourcemap/sourcemap v2.1.4+incompatible // indirect
	github.com/godbus/dbus/v5 v5.2.4 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.32.0 // indirect
	github.com/hashicorp/go-uuid v1.0.4 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.3 // indirect
	github.com/jcmturner/aescts/v2 v2.0.0 // indirect
	github.com/jcmturner/dnsutils/v2 v2.0.0 // indirect
	github.com/jcmturner/gofork v1.7.6 // indirect
	github.com/jcmturner/gokrb5/v8 v8.4.4 // indirect
	github.com/jcmturner/rpc/v2 v2.0.3 // indirect
	github.com/jhump/protoreflect/v2 v2.0.0 // indirect
	github.com/klauspost/compress v1.20.3 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/lufia/plan9stats v0.0.0-20260802145828-341c2f0c90b5 // indirect
	github.com/mattetti/filebuffer v1.0.1 // indirect
	github.com/mattn/go-colorable v0.1.16 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/nats-io/nkeys v0.4.16 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/ncruces/go-strftime v1.1.0 // indirect
	github.com/petermattis/goid v0.0.0-20260918085751-abfca077860b // indirect
	github.com/pierrec/lz4/v4 v4.1.33 // indirect
	github.com/power-devops/perfstat v0.0.0-20260916203055-22a1a467d9f0 // indirect
	github.com/rcrowley/go-metrics v0.0.0-20250401214520-65e299d6c5c9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/tidwall/match v1.2.0 // indirect
	github.com/tidwall/pretty v1.2.2 // indirect
	github.com/tklauser/go-sysconf v0.4.0 // indirect
	github.com/tklauser/numcpus v0.12.0 // indirect
	github.com/u-root/u-root v0.16.0 // indirect
	github.com/xdg-go/pbkdf2 v1.0.0 // indirect
	github.com/xdg-go/stringprep v1.0.4 // indirect
	github.com/yusufpapurcu/wmi v1.2.4 // indirect
	go.uber.org/atomic v1.12.0 // indirect
	golang.org/x/crypto v0.58.0 // indirect
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/text v0.43.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20261012220534-4341edf3f941 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20261012220534-4341edf3f941 // indirect
	modernc.org/libc v1.79.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
)
