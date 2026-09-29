package devcontext

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	composeName   = regexp.MustCompile(`^(docker-)?compose([.-][\w.-]+)?\.ya?ml$`)
	interpolation = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}`)
)

func isCompose(base string) bool { return composeName.MatchString(base) }

type composeService struct {
	Image       string    `yaml:"image"`
	Ports       []any     `yaml:"ports"`
	Environment yaml.Node `yaml:"environment"`
}

func detectCompose(rel string, data []byte, env map[string]string) ([]Entity, error) {
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	services := mappingValue(documentNode(&root), "services")
	if services == nil {
		return nil, nil
	}
	var out []Entity
	for i := 0; i+1 < len(services.Content); i += 2 {
		nameNode, body := services.Content[i], services.Content[i+1]
		var svc composeService
		if err := body.Decode(&svc); err != nil {
			continue
		}
		src := Source{"compose", rel, nameNode.Line}
		confidence := ConfidenceCertain
		image, ok := interpolate(svc.Image, env)
		if !ok {
			confidence = ConfidenceInferred
		}
		hostPort := ""
		var ports []string
		for _, p := range svc.Ports {
			host, container, ok := parsePort(p, env)
			if !ok {
				confidence = ConfidenceInferred
				continue
			}
			if host == "" { // container-only port: Docker picks a random host port
				continue
			}
			ports = append(ports, host+":"+container)
			if hostPort == "" {
				hostPort = host
			}
		}
		attrs := map[string]string{"origin": "compose", "image": image, "ports": strings.Join(ports, ",")}
		if hostPort != "" {
			attrs["host"], attrs["port"] = "localhost", hostPort
		}
		out = append(out, entity("service", "compose:"+nameNode.Value, nameNode.Value, confidence, attrs, src))
		if typ := imageType(image); typ != "" && hostPort != "" {
			user, database := composeCredentials(typ, composeEnv(&svc.Environment, env))
			out = append(out, datasource(typ, "localhost", hostPort, user, database, confidence, src))
		}
	}
	return out, nil
}

func interpolate(s string, env map[string]string) (string, bool) {
	ok := true
	out := interpolation.ReplaceAllStringFunc(s, func(m string) string {
		parts := interpolation.FindStringSubmatch(m)
		if v := env[parts[1]]; v != "" {
			return v
		}
		if strings.Contains(m, "-") { // ${VAR:-default} or ${VAR-default}
			return parts[2]
		}
		ok = false
		return m
	})
	return out, ok
}

// parsePort returns host and container port; host is "" for container-only ports.
func parsePort(p any, env map[string]string) (string, string, bool) {
	switch v := p.(type) {
	case int:
		return "", strconv.Itoa(v), true
	case string:
		s, ok := interpolate(v, env)
		if !ok {
			return "", "", false
		}
		parts := strings.Split(strings.SplitN(s, "/", 2)[0], ":")
		switch len(parts) {
		case 1:
			return "", parts[0], true
		case 2:
			return parts[0], parts[1], true
		case 3:
			return parts[1], parts[2], true
		}
	case map[string]any:
		published, target := fmt.Sprint(v["published"]), fmt.Sprint(v["target"])
		if v["published"] == nil {
			published = ""
		}
		return published, target, v["target"] != nil
	}
	return "", "", false
}

func imageType(image string) string {
	name := image
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	if i := strings.IndexAny(name, ":@"); i >= 0 {
		name = name[:i]
	}
	switch name {
	case "postgres", "postgis":
		return "postgres"
	case "mysql", "mariadb":
		return "mysql"
	case "mongo":
		return "mongodb"
	case "redis", "redis-stack", "redis-stack-server", "valkey":
		return "redis"
	case "kafka", "cp-kafka", "cp-server", "redpanda":
		return "kafka"
	case "rabbitmq":
		return "rabbitmq"
	case "nats":
		return "nats"
	}
	return ""
}

func composeEnv(node *yaml.Node, env map[string]string) map[string]string {
	vars := map[string]string{}
	switch node.Kind {
	case yaml.MappingNode:
		var m map[string]any
		if node.Decode(&m) == nil {
			for k, v := range m {
				vars[k] = fmt.Sprint(v)
			}
		}
	case yaml.SequenceNode:
		var list []string
		if node.Decode(&list) == nil {
			for _, item := range list {
				if k, v, ok := strings.Cut(item, "="); ok {
					vars[k] = v
				}
			}
		}
	}
	for k, v := range vars {
		vars[k], _ = interpolate(v, env)
	}
	return vars
}

// composeCredentials reads user and database only; passwords are never read.
func composeCredentials(typ string, vars map[string]string) (string, string) {
	switch typ {
	case "postgres":
		user := firstNonEmpty(vars["POSTGRES_USER"], "postgres")
		return user, firstNonEmpty(vars["POSTGRES_DB"], user)
	case "mysql":
		return firstNonEmpty(vars["MYSQL_USER"], vars["MARIADB_USER"], "root"), firstNonEmpty(vars["MYSQL_DATABASE"], vars["MARIADB_DATABASE"])
	case "mongodb":
		return vars["MONGO_INITDB_ROOT_USERNAME"], vars["MONGO_INITDB_DATABASE"]
	}
	return "", ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func documentNode(n *yaml.Node) *yaml.Node {
	if n.Kind == yaml.DocumentNode && len(n.Content) > 0 {
		return n.Content[0]
	}
	return n
}

func mappingValue(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}
