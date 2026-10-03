package golang

import (
	"adomnia/internal/ide/dap"
	"fmt"
	"regexp"
	"strings"
)

var delveHitCondition = regexp.MustCompile(`^(>=|<=|==|!=|>|<|%)?\s*[0-9]+$`)

func validateHitCondition(value string) error {
	value = strings.TrimSpace(value)
	if value != "" && !delveHitCondition.MatchString(value) {
		return fmt.Errorf("hit count %q not valid: use a number (stop at that hit) or >= N, == N, %% N", value)
	}
	return nil
}
func NormalizeBreakpoints(values []dap.Breakpoint) ([]dap.Breakpoint, error) {
	for _, value := range values {
		if err := validateHitCondition(value.HitCondition); err != nil {
			return nil, err
		}
	}
	return dap.NormalizeBreakpoints(values)
}
func NormalizeFunctionBreakpoints(settings dap.FunctionBreakpointSettings) (dap.FunctionBreakpointSettings, error) {
	for _, value := range settings.Functions {
		if err := validateHitCondition(value.HitCondition); err != nil {
			return dap.FunctionBreakpointSettings{}, err
		}
	}
	return dap.NormalizeFunctionBreakpoints(settings)
}
