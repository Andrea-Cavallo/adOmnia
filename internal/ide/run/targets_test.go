package run

import (
	"context"
	"testing"
)

type fixtureTargetResolver struct{}

func (fixtureTargetResolver) DiscoverRunTargets(context.Context, string) ([]RunTarget, error) {
	return nil, nil
}

func (fixtureTargetResolver) ResolveRunTarget(_ context.Context, request ResolveTargetRequest) (RunTarget, error) {
	return RunTarget{ModuleDir: request.Root + "/module", Package: "./cmd/api"}, nil
}

func TestResolveTargetUsesOptionalAdapterCapability(t *testing.T) {
	request := Request{Root: "/project", WorkingDirectory: "/project", Target: ".", Kind: "run"}
	resolved, err := ResolveTarget(context.Background(), fixtureTargetResolver{}, request)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.WorkingDirectory != "/project/module" || resolved.Target != "./cmd/api" {
		t.Fatalf("resolved = %#v", resolved)
	}
	unchanged, err := ResolveTarget(context.Background(), struct{}{}, request)
	if err != nil || unchanged.Target != "." {
		t.Fatalf("unchanged = %#v, %v", unchanged, err)
	}
}
