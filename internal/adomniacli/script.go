package adomniacli

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"adomnia/internal/httpexec"
	"github.com/dop251/goja"
)

type scriptTest struct {
	Name  string
	Error string
}

func runHeadlessScript(source string, vars map[string]string, response *httpexec.HTTPExecResponse) ([]scriptTest, error) {
	if strings.TrimSpace(source) == "" {
		return nil, nil
	}
	runtime := goja.New()
	timer := time.AfterFunc(2*time.Second, func() { runtime.Interrupt("script execution timed out") })
	defer timer.Stop()
	tests := []scriptTest{}
	environment := map[string]any{
		"get":   func(key string) string { return vars[key] },
		"set":   func(key string, value any) { vars[key] = fmt.Sprint(value) },
		"unset": func(key string) { delete(vars, key) },
	}
	responseObject := map[string]any{"code": 0, "headers": map[string]string{}, "text": func() string { return "" }, "json": func() any { return nil }}
	if response != nil {
		responseObject["code"] = response.Status
		responseObject["headers"] = response.Headers
		responseObject["text"] = func() string { return response.Body }
		responseObject["json"] = func() any { var value any; _ = json.Unmarshal([]byte(response.Body), &value); return value }
	}
	pm := runtime.NewObject()
	_ = pm.Set("environment", environment)
	_ = pm.Set("response", responseObject)
	_ = pm.Set("test", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		fn, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			tests = append(tests, scriptTest{Name: name, Error: "test callback required"})
			return goja.Undefined()
		}
		_, err := fn(goja.Undefined())
		item := scriptTest{Name: name}
		if err != nil {
			item.Error = err.Error()
		}
		tests = append(tests, item)
		return goja.Undefined()
	})
	_ = pm.Set("expect", func(call goja.FunctionCall) goja.Value { return expectation(runtime, call.Argument(0)) })
	_ = runtime.Set("pm", pm)
	_ = runtime.Set("adomnia", pm)
	if _, err := runtime.RunString(source); err != nil {
		return tests, fmt.Errorf("script: %w", err)
	}
	for _, test := range tests {
		if test.Error != "" {
			return tests, fmt.Errorf("script test %q failed: %s", test.Name, test.Error)
		}
	}
	return tests, nil
}

func expectation(runtime *goja.Runtime, actual goja.Value) goja.Value {
	root := runtime.NewObject()
	to := runtime.NewObject()
	fail := func(message string) { panic(runtime.NewGoError(fmt.Errorf("expectation failed: %s", message))) }
	_ = to.Set("equal", func(expected any) {
		if actual.Export() != expected {
			fail(fmt.Sprintf("%v does not equal %v", actual.Export(), expected))
		}
	})
	_ = to.Set("contain", func(expected string) {
		if !strings.Contains(actual.String(), expected) {
			fail(fmt.Sprintf("%q does not contain %q", actual.String(), expected))
		}
	})
	getter := runtime.ToValue(func(goja.FunctionCall) goja.Value {
		if goja.IsUndefined(actual) || goja.IsNull(actual) {
			fail("value does not exist")
		}
		return goja.Undefined()
	})
	_ = to.DefineAccessorProperty("exist", getter, goja.Undefined(), goja.FLAG_FALSE, goja.FLAG_TRUE)
	_ = root.Set("to", to)
	return root
}
