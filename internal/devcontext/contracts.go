package devcontext

import (
	"fmt"
	"path"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	oasYAMLRoot = regexp.MustCompile(`(?m)^(openapi|swagger)\s*:`)
	oasJSONRoot = regexp.MustCompile(`"(openapi|swagger)"\s*:`)
	oasMethods  = map[string]bool{"get": true, "put": true, "post": true, "delete": true, "options": true, "head": true, "patch": true, "trace": true}
)

func contractEntity(rel, typ string) Entity {
	return entity("contract", rel, path.Base(rel), ConfidenceCertain,
		map[string]string{"type": typ, "path": rel}, Source{"contracts", rel, 1})
}

func detectContractFile(rel string, _ []byte) ([]Entity, error) {
	return []Entity{contractEntity(rel, strings.TrimPrefix(path.Ext(rel), "."))}, nil
}

func detectOpenAPI(rel string, data []byte) ([]Entity, error) {
	head := data
	if len(head) > 4096 {
		head = head[:4096]
	}
	root := oasYAMLRoot
	if strings.HasSuffix(rel, ".json") {
		root = oasJSONRoot
	}
	if !root.Match(head) {
		return nil, nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("invalid OpenAPI document: %w", err)
	}
	out := []Entity{contractEntity(rel, "oas")}
	paths := mappingValue(documentNode(&doc), "paths")
	if paths == nil {
		return out, nil
	}
	for i := 0; i+1 < len(paths.Content); i += 2 {
		p, ops := paths.Content[i].Value, paths.Content[i+1]
		if ops.Kind != yaml.MappingNode {
			continue
		}
		for j := 0; j+1 < len(ops.Content); j += 2 {
			method := strings.ToLower(ops.Content[j].Value)
			if !oasMethods[method] {
				continue
			}
			out = append(out, routeEntity(strings.ToUpper(method), p, ConfidenceCertain,
				map[string]string{"contract": rel}, Source{"oas", rel, ops.Content[j].Line}))
		}
	}
	return out, nil
}
