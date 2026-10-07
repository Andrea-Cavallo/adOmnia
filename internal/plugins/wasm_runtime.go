package plugins

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

// WASM plugins are WASI command modules (GOOS=wasip1, Rust wasm32-wasip1, TinyGo…). The contract is
// deliberately plain so any language can implement it:
//
//	stdin  ← {"function": "<action or hook>", "args": {...}, "settings": {...}, "pluginId": "..."}
//	stdout → the JSON result (empty = no result)
//	stderr → plugin log lines
//	exit   → 0 on success; any other code is an error, with stderr as the message
//
// The module gets no filesystem, no network, no environment and no clock beyond WASI defaults:
// it can only compute on what it is given. Memory and time are capped by the sandbox limits.

const wasmPageSize = 64 << 10

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, fmt.Errorf("plugin output exceeds %d bytes", b.limit)
	}
	return b.Buffer.Write(p)
}

func executeWasmPlugin(plugin PluginInstance, function string, args map[string]interface{}, timeLimit time.Duration, memoryLimit int64) (interface{}, int64, []string, error) {
	entryPoint, err := ResolvePluginEntryPoint(plugin.InstallDir, plugin.Manifest.EntryPoint)
	if err != nil {
		return nil, 0, nil, err
	}
	binary, err := os.ReadFile(entryPoint)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("failed to read plugin module: %w", err)
	}
	input, err := json.Marshal(map[string]interface{}{"function": function, "args": args, "settings": plugin.Settings, "pluginId": plugin.Manifest.ID})
	if err != nil {
		return nil, 0, nil, fmt.Errorf("failed to encode plugin arguments: %w", err)
	}
	memUsed := int64(len(input))
	ctx, cancel := context.WithTimeout(context.Background(), timeLimit)
	defer cancel()
	pages := uint32(max(memoryLimit/wasmPageSize, 1))
	runtime := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithCloseOnContextDone(true).WithMemoryLimitPages(pages))
	defer runtime.Close(context.Background())
	wasi_snapshot_preview1.MustInstantiate(ctx, runtime)

	stdout := &limitedBuffer{limit: int(min(memoryLimit, 16<<20))}
	stderr := &limitedBuffer{limit: 64 << 10}
	config := wazero.NewModuleConfig().
		WithStdin(bytes.NewReader(input)).WithStdout(stdout).WithStderr(stderr).
		WithArgs(plugin.Manifest.ID, function).WithName("")
	compiled, err := runtime.CompileModule(ctx, binary)
	if err != nil {
		return nil, memUsed, nil, fmt.Errorf("invalid WASM module: %w", err)
	}
	_, runErr := runtime.InstantiateModule(ctx, compiled, config)
	logs := splitLogLines(stderr.String())
	var exit *sys.ExitError
	if errors.As(runErr, &exit) && exit.ExitCode() == 0 {
		runErr = nil
	}
	if runErr != nil {
		if ctx.Err() != nil {
			return nil, memUsed, logs, fmt.Errorf("plugin execution timed out after %s", timeLimit)
		}
		if detail := strings.TrimSpace(stderr.String()); detail != "" {
			return nil, memUsed, logs, fmt.Errorf("plugin function %s failed: %s", function, lastLine(detail))
		}
		return nil, memUsed, logs, fmt.Errorf("plugin function %s failed: %w", function, runErr)
	}
	memUsed += int64(stdout.Len())
	output := bytes.TrimSpace(stdout.Bytes())
	if len(output) == 0 {
		return nil, memUsed, logs, nil
	}
	var result interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, memUsed, logs, fmt.Errorf("plugin function %s wrote non-JSON output: %w", function, err)
	}
	return result, memUsed, logs, nil
}

func splitLogLines(text string) []string {
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func lastLine(text string) string {
	lines := splitLogLines(text)
	if len(lines) == 0 {
		return text
	}
	return lines[len(lines)-1]
}
