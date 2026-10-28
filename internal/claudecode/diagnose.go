package claudecode

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

type DiagnosticStep struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type Diagnosis struct {
	Command    string            `json:"command"`
	Arguments  []string          `json:"arguments"`
	Paths      map[string]string `json:"paths"`
	Proxy      string            `json:"proxy,omitempty"`
	CAFile     string            `json:"caFile,omitempty"`
	Steps      []DiagnosticStep  `json:"steps"`
	LastStderr []string          `json:"lastStderr"`
}

func Diagnose(ctx context.Context, root string, settings milk.Settings, lastLog []string) Diagnosis {
	env := agentEnvironment()
	for name, value := range settingsEnvironment(root, os.Getenv) {
		env = setEnv(env, name, value)
	}
	for name, value := range settings.Env {
		env = setEnv(env, name, value)
	}
	result := Diagnosis{Paths: map[string]string{}, Proxy: hostOf(envValue(env, "HTTPS_PROXY")), CAFile: envValue(env, "SSL_CERT_FILE")}
	for _, name := range []string{"node", "npx", "npm", "claude", "claude-agent-acp", "aws"} {
		if path, err := exec.LookPath(name); err == nil {
			result.Paths[name] = path
		}
	}
	if launch, err := command(settings, exec.LookPath); err != nil {
		result.Steps = append(result.Steps, DiagnosticStep{Name: "Adapter", Status: "error", Detail: err.Error()})
	} else {
		result.Command, result.Arguments = launch.Binary, launch.Args
		result.Steps = append(result.Steps, DiagnosticStep{Name: "Adapter", Status: "ok", Detail: launch.Binary})
	}

	request, _ := http.NewRequestWithContext(ctx, http.MethodHead, "https://registry.npmjs.org/@agentclientprotocol%2fclaude-agent-acp", nil)
	response, err := netpolicy.Client("claude-diagnose", 10*time.Second).Do(request)
	if err != nil {
		result.Steps = append(result.Steps, DiagnosticStep{Name: "npm registry", Status: "error", Detail: milk.RedactAgentText(err.Error())})
	} else {
		_ = response.Body.Close()
		detail := fmt.Sprintf("HTTP %d", response.StatusCode)
		if response.Request != nil && response.Request.URL != nil && response.Request.URL.Hostname() != "registry.npmjs.org" {
			detail += "; redirected to " + response.Request.URL.Hostname()
		}
		status := "ok"
		if response.StatusCode >= 400 || strings.Contains(detail, "redirected") {
			status = "error"
		}
		result.Steps = append(result.Steps, DiagnosticStep{Name: "npm registry", Status: status, Detail: detail})
	}
	if truthy(envValue(env, "CLAUDE_CODE_USE_BEDROCK")) {
		if aws := result.Paths["aws"]; aws == "" {
			result.Steps = append(result.Steps, DiagnosticStep{Name: "AWS Bedrock identity", Status: "error", Detail: "aws CLI not found"})
		} else {
			checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			cmd := procutil.CommandContext(checkCtx, aws, "sts", "get-caller-identity", "--output", "json")
			cmd.Dir, cmd.Env = root, env
			output, checkErr := cmd.CombinedOutput()
			cancel()
			if checkErr != nil {
				result.Steps = append(result.Steps, DiagnosticStep{Name: "AWS Bedrock identity", Status: "error", Detail: milk.RedactAgentText(strings.TrimSpace(string(output)))})
			} else {
				result.Steps = append(result.Steps, DiagnosticStep{Name: "AWS Bedrock identity", Status: "ok", Detail: "AWS identity available"})
			}
		}
	}
	for _, line := range lastLog {
		if strings.HasPrefix(line, "stderr:") {
			result.LastStderr = append(result.LastStderr, milk.RedactAgentText(line))
		}
	}
	if len(result.LastStderr) > 20 {
		result.LastStderr = result.LastStderr[len(result.LastStderr)-20:]
	}
	return result
}

func InstallAdapter(ctx context.Context) (string, error) {
	npm, err := exec.LookPath("npm")
	if err != nil {
		return "", milk.NotInstalled("npm was not found. Install Node.js 22 or choose an existing claude-agent-acp executable")
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	destination := filepath.Join(cache, "adomnia", "tools", "claude-agent-acp")
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return "", err
	}
	installCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	cmd := procutil.CommandContext(installCtx, npm, "install", "--prefix", destination, "--no-audit", "--no-fund", AdapterPackage)
	cmd.Env = agentEnvironment()
	output, err := cmd.CombinedOutput()
	if err != nil {
		lines := strings.Split(string(output), "\n")
		for index := range lines {
			lines[index] = milk.RedactAgentText(lines[index])
		}
		return "", fmt.Errorf("adapter install failed: %s", milk.StartupFailureMessage("npm", err, lines, nil))
	}
	binary := filepath.Join(destination, "node_modules", ".bin", "claude-agent-acp")
	if _, err := os.Stat(binary); err != nil {
		binary += ".cmd"
	}
	if _, err := os.Stat(binary); err != nil {
		return "", fmt.Errorf("adapter installed but executable was not found in %s", destination)
	}
	return binary, nil
}
