package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Deployment is one deployment from `kubectl get deployments`.
type Deployment struct {
	Name      string            `json:"name"`
	Ready     string            `json:"ready"`
	UpToDate  int32             `json:"upToDate"`
	Available int32             `json:"available"`
	Age       string            `json:"age"`
	Images    []string          `json:"images"`
	Selector  map[string]string `json:"selector"`
}

// ServicePort is one port exposed by a service.
type ServicePort struct {
	Name       string `json:"name"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort"`
	NodePort   int32  `json:"nodePort"`
	Protocol   string `json:"protocol"`
}

// Service is one service from `kubectl get services`.
type Service struct {
	Name      string            `json:"name"`
	Type      string            `json:"type"`
	ClusterIP string            `json:"clusterIP"`
	External  string            `json:"external"`
	Ports     []ServicePort     `json:"ports"`
	Selector  map[string]string `json:"selector"`
	Age       string            `json:"age"`
}

// ConfigMap is one config map with its full data: config maps are not secret.
type ConfigMap struct {
	Name string            `json:"name"`
	Data map[string]string `json:"data"`
	Age  string            `json:"age"`
}

// SecretKey describes one secret entry without its value.
type SecretKey struct {
	Name  string `json:"name"`
	Bytes int    `json:"bytes"`
}

// Secret is secret metadata only. Values are dropped while parsing and never
// leave this package, so the UI cannot show them even by mistake.
type Secret struct {
	Name string      `json:"name"`
	Type string      `json:"type"`
	Keys []SecretKey `json:"keys"`
	Age  string      `json:"age"`
}

type objectMeta struct {
	Name              string `json:"name"`
	CreationTimestamp string `json:"creationTimestamp"`
}

func parseDeployments(raw []byte) ([]Deployment, error) {
	var list struct {
		Items []struct {
			Metadata objectMeta `json:"metadata"`
			Spec     struct {
				Replicas *int32 `json:"replicas"`
				Selector struct {
					MatchLabels map[string]string `json:"matchLabels"`
				} `json:"selector"`
				Template struct {
					Spec struct {
						Containers []struct {
							Image string `json:"image"`
						} `json:"containers"`
					} `json:"spec"`
				} `json:"template"`
			} `json:"spec"`
			Status struct {
				ReadyReplicas     int32 `json:"readyReplicas"`
				UpdatedReplicas   int32 `json:"updatedReplicas"`
				AvailableReplicas int32 `json:"availableReplicas"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	out := make([]Deployment, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Metadata.Name == "" {
			continue
		}
		desired := int32(1) // Kubernetes defaults replicas to 1 when unset.
		if item.Spec.Replicas != nil {
			desired = *item.Spec.Replicas
		}
		images := []string{}
		for _, c := range item.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}
		out = append(out, Deployment{
			Name:      item.Metadata.Name,
			Ready:     fmt.Sprintf("%d/%d", item.Status.ReadyReplicas, desired),
			UpToDate:  item.Status.UpdatedReplicas,
			Available: item.Status.AvailableReplicas,
			Age:       humanAge(item.Metadata.CreationTimestamp),
			Images:    images,
			Selector:  nonNil(item.Spec.Selector.MatchLabels),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func parseServices(raw []byte) ([]Service, error) {
	var list struct {
		Items []struct {
			Metadata objectMeta `json:"metadata"`
			Spec     struct {
				Type        string            `json:"type"`
				ClusterIP   string            `json:"clusterIP"`
				ExternalIPs []string          `json:"externalIPs"`
				Selector    map[string]string `json:"selector"`
				Ports       []struct {
					Name       string          `json:"name"`
					Port       int32           `json:"port"`
					TargetPort json.RawMessage `json:"targetPort"`
					NodePort   int32           `json:"nodePort"`
					Protocol   string          `json:"protocol"`
				} `json:"ports"`
			} `json:"spec"`
			Status struct {
				LoadBalancer struct {
					Ingress []struct {
						IP       string `json:"ip"`
						Hostname string `json:"hostname"`
					} `json:"ingress"`
				} `json:"loadBalancer"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	out := make([]Service, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Metadata.Name == "" {
			continue
		}
		external := append([]string{}, item.Spec.ExternalIPs...)
		for _, ingress := range item.Status.LoadBalancer.Ingress {
			if ingress.IP != "" {
				external = append(external, ingress.IP)
			} else if ingress.Hostname != "" {
				external = append(external, ingress.Hostname)
			}
		}
		ports := make([]ServicePort, 0, len(item.Spec.Ports))
		for _, p := range item.Spec.Ports {
			// targetPort is an int-or-string; keep its literal form.
			target := strings.Trim(string(p.TargetPort), `"`)
			ports = append(ports, ServicePort{Name: p.Name, Port: p.Port, TargetPort: target, NodePort: p.NodePort, Protocol: p.Protocol})
		}
		out = append(out, Service{
			Name:      item.Metadata.Name,
			Type:      item.Spec.Type,
			ClusterIP: item.Spec.ClusterIP,
			External:  strings.Join(external, ", "),
			Ports:     ports,
			Selector:  nonNil(item.Spec.Selector),
			Age:       humanAge(item.Metadata.CreationTimestamp),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func parseConfigMaps(raw []byte) ([]ConfigMap, error) {
	var list struct {
		Items []struct {
			Metadata   objectMeta        `json:"metadata"`
			Data       map[string]string `json:"data"`
			BinaryData map[string]string `json:"binaryData"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	out := make([]ConfigMap, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Metadata.Name == "" {
			continue
		}
		data := nonNil(item.Data)
		for key := range item.BinaryData {
			data[key] = "(binary data)"
		}
		out = append(out, ConfigMap{Name: item.Metadata.Name, Data: data, Age: humanAge(item.Metadata.CreationTimestamp)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// parseSecrets keeps key names and decoded sizes; the values are discarded.
func parseSecrets(raw []byte) ([]Secret, error) {
	var list struct {
		Items []struct {
			Metadata objectMeta        `json:"metadata"`
			Type     string            `json:"type"`
			Data     map[string]string `json:"data"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	out := make([]Secret, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Metadata.Name == "" {
			continue
		}
		keys := make([]SecretKey, 0, len(item.Data))
		for key, encoded := range item.Data {
			keys = append(keys, SecretKey{Name: key, Bytes: len(encoded)*3/4 - strings.Count(encoded, "=")})
		}
		sort.Slice(keys, func(i, j int) bool { return keys[i].Name < keys[j].Name })
		out = append(out, Secret{Name: item.Metadata.Name, Type: item.Type, Keys: keys, Age: humanAge(item.Metadata.CreationTimestamp)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func nonNil(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// Resource kinds the overview can list, each with its parser.
var resourceParsers = map[string]func([]byte) (any, error){
	"deployments": func(raw []byte) (any, error) { return parseDeployments(raw) },
	"services":    func(raw []byte) (any, error) { return parseServices(raw) },
	"configmaps":  func(raw []byte) (any, error) { return parseConfigMaps(raw) },
	"secrets":     func(raw []byte) (any, error) { return parseSecrets(raw) },
}

// ListResources lists one supported kind in the chosen context and namespace.
func ListResources(ctx context.Context, contextName, namespace, kind string) (any, error) {
	parse, ok := resourceParsers[kind]
	if !ok {
		return nil, fmt.Errorf("unsupported resource kind %q", kind)
	}
	if err := validateIdentifier(namespace, "namespace"); err != nil {
		return nil, err
	}
	raw, err := run(ctx, contextName, "get", kind, "-n", namespace, "-o", "json")
	if err != nil {
		return nil, err
	}
	items, err := parse(raw)
	if err != nil {
		return nil, fmt.Errorf("could not read %s: %w", kind, err)
	}
	return items, nil
}
