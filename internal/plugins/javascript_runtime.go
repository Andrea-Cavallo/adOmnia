package plugins

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/dop251/goja"
)

var (
	exportFunctionPattern = regexp.MustCompile(`(?m)^([ \t]*)export\s+(?:(async)\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)`)
	exportVariablePattern = regexp.MustCompile(`(?m)^([ \t]*)export\s+(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)`)
	exportListPattern     = regexp.MustCompile(`(?m)^([ \t]*)export\s*\{([^}]+)\}\s*;?`)
)

var hostFunctionPermissions = map[string]string{
	"http.fetch":     "http",
	"storage.get":    "storage",
	"storage.set":    "storage",
	"storage.delete": "storage",
	"log.info":       "",
	"log.error":      "",
	"ui.notify":      "notifications",
	"env.get":        "env",
}

func executeJavaScriptPlugin(
	plugin PluginInstance,
	function string,
	args map[string]interface{},
	hostFunctions map[string]HostFunction,
	timeLimit time.Duration,
	memoryLimit int64,
) (interface{}, int64, error) {
	entryPoint, err := ResolvePluginEntryPoint(plugin.InstallDir, plugin.Manifest.EntryPoint)
	if err != nil {
		return nil, 0, err
	}
	source, err := os.ReadFile(entryPoint)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to read plugin entrypoint: %w", err)
	}
	argsJSON, err := json.Marshal(args)
	if err != nil {
		return nil, int64(len(source)), fmt.Errorf("failed to encode plugin arguments: %w", err)
	}
	memUsed := int64(len(source) + len(argsJSON))
	if memUsed > memoryLimit {
		return nil, memUsed, fmt.Errorf("plugin I/O memory limit exceeded before execution: %d > %d bytes", memUsed, memoryLimit)
	}

	vm := goja.New()
	ctx, cancel := context.WithTimeout(context.Background(), timeLimit)
	defer cancel()
	timer := time.AfterFunc(timeLimit, func() {
		vm.Interrupt(fmt.Sprintf("plugin execution timed out after %s", timeLimit))
	})
	defer timer.Stop()

	module := vm.NewObject()
	exports := vm.NewObject()
	if err := module.Set("exports", exports); err != nil {
		return nil, memUsed, err
	}
	if err := vm.Set("module", module); err != nil {
		return nil, memUsed, err
	}
	if err := vm.Set("exports", exports); err != nil {
		return nil, memUsed, err
	}

	api, err := buildPluginAPI(ctx, vm, plugin, hostFunctions)
	if err != nil {
		return nil, memUsed, err
	}
	if err := vm.Set("adomnia", api); err != nil {
		return nil, memUsed, err
	}

	compatibleSource := transformJavaScriptModule(string(source))
	if _, err := vm.RunString(compatibleSource); err != nil {
		return nil, memUsed, fmt.Errorf("plugin entrypoint failed: %w", err)
	}

	var candidate goja.Value
	moduleExports := module.Get("exports")
	if moduleExports != nil && !goja.IsUndefined(moduleExports) && !goja.IsNull(moduleExports) {
		exportsObject := moduleExports.ToObject(vm)
		for _, exportedName := range exportsObject.Keys() {
			if exportedName == function {
				candidate = exportsObject.Get(function)
				break
			}
		}
	}
	callable, ok := goja.AssertFunction(candidate)
	if !ok {
		return nil, memUsed, fmt.Errorf("plugin function is not exported: %s", function)
	}

	value, err := callable(goja.Undefined(), vm.ToValue(args), api)
	if err != nil {
		return nil, memUsed, fmt.Errorf("plugin function %s failed: %w", function, err)
	}
	if promise, ok := value.Export().(*goja.Promise); ok {
		switch promise.State() {
		case goja.PromiseStateFulfilled:
			value = promise.Result()
		case goja.PromiseStateRejected:
			return nil, memUsed, fmt.Errorf("plugin function %s rejected: %s", function, promise.Result().String())
		default:
			return nil, memUsed, fmt.Errorf("plugin function %s returned a pending promise; asynchronous I/O is not supported", function)
		}
	}
	if goja.IsUndefined(value) || goja.IsNull(value) {
		return nil, memUsed, nil
	}

	resultJSON, err := json.Marshal(value.Export())
	if err != nil {
		return nil, memUsed, fmt.Errorf("plugin function %s returned a non-serializable value: %w", function, err)
	}
	memUsed += int64(len(resultJSON))
	if memUsed > memoryLimit {
		return nil, memUsed, fmt.Errorf("plugin I/O memory limit exceeded after execution: %d > %d bytes", memUsed, memoryLimit)
	}
	var result interface{}
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		return nil, memUsed, fmt.Errorf("failed to normalize plugin result: %w", err)
	}
	return result, memUsed, nil
}

func transformJavaScriptModule(source string) string {
	exported := make([]string, 0)
	type exportAlias struct{ name, alias string }
	aliases := make([]exportAlias, 0)
	source = exportFunctionPattern.ReplaceAllStringFunc(source, func(match string) string {
		parts := exportFunctionPattern.FindStringSubmatch(match)
		exported = append(exported, parts[3])
		if parts[2] == "async" {
			return parts[1] + "async function " + parts[3]
		}
		return parts[1] + "function " + parts[3]
	})
	source = exportVariablePattern.ReplaceAllStringFunc(source, func(match string) string {
		parts := exportVariablePattern.FindStringSubmatch(match)
		exported = append(exported, parts[3])
		return parts[1] + parts[2] + " " + parts[3]
	})
	source = exportListPattern.ReplaceAllStringFunc(source, func(match string) string {
		parts := exportListPattern.FindStringSubmatch(match)
		for _, item := range strings.Split(parts[2], ",") {
			name := strings.TrimSpace(strings.Split(strings.TrimSpace(item), " as ")[0])
			aliasParts := strings.Split(strings.TrimSpace(item), " as ")
			alias := name
			if len(aliasParts) == 2 {
				alias = strings.TrimSpace(aliasParts[1])
			}
			if name != "" && alias != "" {
				aliases = append(aliases, exportAlias{name: name, alias: alias})
			}
		}
		return ""
	})
	for _, name := range exported {
		source += fmt.Sprintf("\nmodule.exports[%q] = %s;", name, name)
	}
	for _, item := range aliases {
		source += fmt.Sprintf("\nmodule.exports[%q] = %s;", item.alias, item.name)
	}
	return source
}

func buildPluginAPI(ctx context.Context, vm *goja.Runtime, plugin PluginInstance, hostFunctions map[string]HostFunction) (*goja.Object, error) {
	api := vm.NewObject()
	if err := api.Set("pluginId", plugin.Manifest.ID); err != nil {
		return nil, err
	}
	if err := api.Set("settings", plugin.Settings); err != nil {
		return nil, err
	}

	groups := map[string]*goja.Object{}
	for _, group := range []string{"http", "storage", "log", "ui", "env"} {
		groups[group] = vm.NewObject()
		if err := api.Set(group, groups[group]); err != nil {
			return nil, err
		}
	}
	for fullName, hostFunction := range hostFunctions {
		parts := strings.SplitN(fullName, ".", 2)
		if len(parts) != 2 || groups[parts[0]] == nil {
			continue
		}
		name := fullName
		fn := hostFunction
		if err := groups[parts[0]].Set(parts[1], func(call goja.FunctionCall) goja.Value {
			return invokeHostFunction(ctx, vm, plugin, name, fn, call.Argument(0))
		}); err != nil {
			return nil, err
		}
	}
	if err := api.Set("call", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		fn, ok := hostFunctions[name]
		if !ok {
			panic(vm.NewGoError(fmt.Errorf("unknown host function: %s", name)))
		}
		return invokeHostFunction(ctx, vm, plugin, name, fn, call.Argument(1))
	}); err != nil {
		return nil, err
	}
	return api, nil
}

func invokeHostFunction(ctx context.Context, vm *goja.Runtime, plugin PluginInstance, name string, fn HostFunction, value goja.Value) goja.Value {
	permission := hostFunctionPermissions[name]
	if permission != "" && !hasPluginPermission(plugin.Manifest.Permissions, permission) {
		panic(vm.NewGoError(fmt.Errorf("permission denied: %s requires %s", name, permission)))
	}
	params := map[string]interface{}{}
	if value != nil && !goja.IsUndefined(value) && !goja.IsNull(value) {
		switch exported := value.Export().(type) {
		case map[string]interface{}:
			for key, item := range exported {
				params[key] = item
			}
		case string:
			switch name {
			case "log.info", "log.error":
				params["message"] = exported
			case "env.get":
				params["name"] = exported
			default:
				params["value"] = exported
			}
		default:
			params["value"] = exported
		}
	}
	params["pluginId"] = plugin.Manifest.ID
	raw, err := json.Marshal(params)
	if err != nil {
		panic(vm.NewGoError(fmt.Errorf("failed to encode %s arguments: %w", name, err)))
	}
	result, err := fn(ctx, raw)
	if err != nil {
		panic(vm.NewGoError(err))
	}
	if len(result) == 0 {
		return goja.Undefined()
	}
	var decoded interface{}
	if err := json.Unmarshal(result, &decoded); err != nil {
		panic(vm.NewGoError(fmt.Errorf("invalid %s result: %w", name, err)))
	}
	return vm.ToValue(decoded)
}

func hasPluginPermission(permissions []string, wanted string) bool {
	for _, permission := range permissions {
		permission = strings.ToLower(strings.TrimSpace(permission))
		if permission == wanted || permission == "*" {
			return true
		}
	}
	return false
}
