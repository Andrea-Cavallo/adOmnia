package run

import "context"

// RunTarget is a runnable package discovered by a language adapter. Dir is the
// package directory, ModuleDir is the owning build unit and Package is relative
// to ModuleDir ("." or "./cmd/api").
type RunTarget struct {
	Dir       string `json:"dir"`
	ModuleDir string `json:"moduleDir"`
	Package   string `json:"package"`
	Label     string `json:"label"`
}

type ResolveTargetRequest struct {
	Root             string
	WorkingDirectory string
	Target           string
	Kind             string
}

// TargetResolver is optional. The IDE core asks it to discover or resolve
// runnable targets without knowing anything about a concrete language.
type TargetResolver interface {
	DiscoverRunTargets(context.Context, string) ([]RunTarget, error)
	ResolveRunTarget(context.Context, ResolveTargetRequest) (RunTarget, error)
}

// ResolveTarget applies an adapter's optional target resolver before command
// construction. Adapters without the capability keep the request unchanged.
func ResolveTarget(ctx context.Context, adapter any, request Request) (Request, error) {
	resolver, ok := adapter.(TargetResolver)
	if !ok {
		return request, nil
	}
	target, err := resolver.ResolveRunTarget(ctx, ResolveTargetRequest{
		Root: request.Root, WorkingDirectory: request.WorkingDirectory, Target: request.Target, Kind: request.Kind,
	})
	if err != nil {
		return Request{}, err
	}
	request.WorkingDirectory = target.ModuleDir
	request.Target = target.Package
	return request, nil
}
