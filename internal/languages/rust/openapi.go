package rust

import "regexp"

// deriveOpenApi è `#[derive(... OpenApi ...)]` (l'aggregatore OpenAPI di utoipa).
var deriveOpenApi = regexp.MustCompile(`derive\s*\([^)]*\bOpenApi\b`)

// HasOpenApiDerive dice se il sorgente dichiara un `#[derive(OpenApi)]`: il crate espone un
// contratto OpenAPI generato da utoipa. L'import del `.json` generato a runtime avviene solo su
// azione (nessun fetch automatico), come per Python (RS-7.2).
func HasOpenApiDerive(data []byte) bool {
	return deriveOpenApi.Match(data)
}
