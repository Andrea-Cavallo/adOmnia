package kube

import (
	"fmt"
	"net"
	"strings"
	"testing"
	"time"
)

func TestParseNamespaces(t *testing.T) {
	raw := []byte(`{
		"items": [
			{"metadata": {"name": "kube-system"}, "status": {"phase": "Active"}},
			{"metadata": {"name": "default"}, "status": {"phase": "Active"}},
			{"metadata": {"name": "terminating"}, "status": {"phase": "Terminating"}},
			{"metadata": {"name": ""}, "status": {"phase": "Active"}}
		]
	}`)
	namespaces, err := parseNamespaces(raw)
	if err != nil {
		t.Fatalf("parseNamespaces: %v", err)
	}
	if len(namespaces) != 3 {
		t.Fatalf("expected 3 namespaces, got %d", len(namespaces))
	}
	if namespaces[0].Name != "default" || namespaces[1].Name != "kube-system" || namespaces[2].Name != "terminating" {
		t.Fatalf("unexpected sorted order: %+v", namespaces)
	}
	if namespaces[2].Status != "Terminating" {
		t.Fatalf("expected Terminating status, got %q", namespaces[2].Status)
	}
}

func TestParseNamespacesMalformed(t *testing.T) {
	if _, err := parseNamespaces([]byte(`{"items":`)); err == nil {
		t.Fatal("expected an error for malformed JSON")
	}
}

func TestParsePods(t *testing.T) {
	raw := []byte(`{
		"items": [
			{
				"metadata": {
					"name": "api-7d9f5c8b46-x2kzq",
					"namespace": "payments",
					"labels": {"app": "api"},
					"creationTimestamp": "2026-10-04T08:00:00Z"
				},
				"spec": {
					"nodeName": "node-1",
					"containers": [{"name": "api"}, {"name": "sidecar"}]
				},
				"status": {
					"phase": "Running",
					"containerStatuses": [
						{"name": "api", "ready": true, "restartCount": 0},
						{"name": "sidecar", "ready": false, "restartCount": 2}
					]
				}
			},
			{
				"metadata": {"name": "worker", "namespace": "payments", "creationTimestamp": "2026-10-04T09:00:00Z"},
				"spec": {"containers": [{"name": "worker"}]},
				"status": {"phase": "Pending", "containerStatuses": []}
			}
		]
	}`)
	pods, err := parsePods(raw)
	if err != nil {
		t.Fatalf("parsePods: %v", err)
	}
	if len(pods) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(pods))
	}
	if pods[0].Name != "api-7d9f5c8b46-x2kzq" {
		t.Fatalf("expected api pod first, got %q", pods[0].Name)
	}
	if pods[0].Ready != "1/2" {
		t.Fatalf("expected ready 1/2, got %q", pods[0].Ready)
	}
	if pods[0].Restarts != 2 {
		t.Fatalf("expected 2 restarts, got %d", pods[0].Restarts)
	}
	if pods[0].Node != "node-1" {
		t.Fatalf("expected node-1, got %q", pods[0].Node)
	}
	if pods[0].Containers[0] != "api" || pods[0].Containers[1] != "sidecar" {
		t.Fatalf("unexpected containers: %+v", pods[0].Containers)
	}
	if pods[0].Labels["app"] != "api" {
		t.Fatalf("expected app label, got %+v", pods[0].Labels)
	}
	if pods[1].Ready != "0/1" || pods[1].Phase != "Pending" {
		t.Fatalf("unexpected worker pod: %+v", pods[1])
	}
	if pods[1].Labels == nil {
		t.Fatal("expected non-nil labels for a pod without labels")
	}
}

func TestHumanAge(t *testing.T) {
	cases := []struct {
		name    string
		now     string
		created string
		want    string
	}{
		{"seconds", "2026-10-04T08:00:30Z", "2026-10-04T08:00:00Z", "30s"},
		{"minutes", "2026-10-04T08:05:00Z", "2026-10-04T08:00:00Z", "5m"},
		{"hours", "2026-10-04T12:00:00Z", "2026-10-04T08:00:00Z", "4h"},
		{"days", "2026-10-07T08:00:00Z", "2026-10-04T08:00:00Z", "3d"},
		{"unparsable", "2026-10-04T08:00:00Z", "not-a-timestamp", ""},
		{"future clamps to zero", "2026-10-04T08:00:00Z", "2026-10-04T09:00:00Z", "0s"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := humanAgeAt(tc.created, mustTime(t, tc.now))
			if got != tc.want {
				t.Fatalf("humanAgeAt(%q) = %q, want %q", tc.created, got, tc.want)
			}
		})
	}
}

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestValidateIdentifier(t *testing.T) {
	if err := validateIdentifier("default", "namespace"); err != nil {
		t.Fatalf("expected valid identifier, got %v", err)
	}
	if err := validateIdentifier("", "namespace"); err == nil {
		t.Fatal("expected error for empty identifier")
	}
	if err := validateIdentifier("bad\nname", "context"); err == nil {
		t.Fatal("expected error for control character")
	}
}

func TestWithContext(t *testing.T) {
	args, err := withContext([]string{"get", "pods"}, "prod")
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 4 || args[2] != "--context" || args[3] != "prod" {
		t.Fatalf("unexpected args: %+v", args)
	}
	args, err = withContext([]string{"get", "pods"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 2 {
		t.Fatalf("expected no context flag, got %+v", args)
	}
}

func TestParseSecretsDropsValues(t *testing.T) {
	raw := []byte(`{"items":[{"metadata":{"name":"db"},"type":"Opaque","data":{"password":"c2VjcmV0","user":"YWRtaW4="}}]}`)
	secrets, err := parseSecrets(raw)
	if err != nil {
		t.Fatalf("parseSecrets: %v", err)
	}
	if len(secrets) != 1 || len(secrets[0].Keys) != 2 {
		t.Fatalf("unexpected secrets: %+v", secrets)
	}
	if secrets[0].Keys[0] != (SecretKey{Name: "password", Bytes: 6}) || secrets[0].Keys[1] != (SecretKey{Name: "user", Bytes: 5}) {
		t.Fatalf("unexpected keys: %+v", secrets[0].Keys)
	}
	if encoded := fmt.Sprintf("%+v", secrets); strings.Contains(encoded, "c2VjcmV0") || strings.Contains(encoded, "secret") {
		t.Fatalf("secret value leaked: %s", encoded)
	}
}

func TestParseDeploymentsAndServices(t *testing.T) {
	deployments, err := parseDeployments([]byte(`{"items":[{"metadata":{"name":"api"},"spec":{"replicas":3,"selector":{"matchLabels":{"app":"api"}},"template":{"spec":{"containers":[{"image":"api:1.2"}]}}},"status":{"readyReplicas":2,"updatedReplicas":3,"availableReplicas":2}}]}`))
	if err != nil || len(deployments) != 1 || deployments[0].Ready != "2/3" || deployments[0].Images[0] != "api:1.2" {
		t.Fatalf("deployments: %+v %v", deployments, err)
	}
	services, err := parseServices([]byte(`{"items":[{"metadata":{"name":"api"},"spec":{"type":"ClusterIP","clusterIP":"10.0.0.1","ports":[{"name":"http","port":80,"targetPort":"http","protocol":"TCP"},{"port":9090,"targetPort":9090}]}}]}`))
	if err != nil || len(services) != 1 || services[0].Ports[0].TargetPort != "http" || services[0].Ports[1].TargetPort != "9090" {
		t.Fatalf("services: %+v %v", services, err)
	}
}

func TestStartForwardValidation(t *testing.T) {
	if !Available() {
		t.Skip("kubectl not installed")
	}
	cases := []struct {
		target        string
		local, remote int
	}{
		{"deploy/api", 8080, 80}, {"pod/", 8080, 80}, {"pod/api", -1, 80}, {"svc/api", 8080, 70000},
	}
	for _, c := range cases {
		if _, err := StartForward("", "default", c.target, c.local, c.remote); err == nil {
			t.Fatalf("expected an error for %+v", c)
		}
	}
}

func TestRemotePathRejectsControlChars(t *testing.T) {
	if _, err := remotePath("/tmp/a\nb"); err == nil {
		t.Fatal("expected control characters to be rejected")
	}
	if _, err := remotePath("  "); err == nil {
		t.Fatal("expected an empty path to be rejected")
	}
}

func TestFreeLocalPortIsBindable(t *testing.T) {
	port, err := freeLocalPort()
	if err != nil || !validPort(port) {
		t.Fatalf("port %d, err %v", port, err)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("port %d not bindable: %v", port, err)
	}
	listener.Close()
}
