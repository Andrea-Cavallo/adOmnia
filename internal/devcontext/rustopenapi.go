package devcontext

import (
	"bytes"
	"path"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
)

// detectRustOpenApi: un `#[derive(OpenApi)]` (utoipa) segna il crate come produttore di un
// contratto OpenAPI, che diventa un'entità contract come un file `.yaml`/`.json` OpenAPI. Il `.json`
// generato a runtime si importa solo su azione (nessun fetch automatico).
func detectRustOpenApi(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("OpenApi")) || !rust.HasOpenApiDerive(data) {
		return nil
	}
	return []Entity{entity("contract", rel, path.Base(rel), ConfidenceCertain,
		map[string]string{"type": "utoipa", "path": rel, "language": "rust"}, Source{"rustopenapi", rel, 1})}
}
