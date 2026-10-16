package git

import (
	"testing"
	"time"
)

func TestBranchOperationsRejectOptionLikeNames(t *testing.T) {
	for _, name := range []string{"--orphan", "-f", " -b"} {
		if err := CheckoutBranch(t.TempDir(), name); err == nil {
			t.Errorf("CheckoutBranch(%q) must be rejected", name)
		}
		if err := CreateAndCheckoutBranch(t.TempDir(), name); err == nil {
			t.Errorf("CreateAndCheckoutBranch(%q) must be rejected", name)
		}
		if err := MergeBranch(t.TempDir(), name); err == nil {
			t.Errorf("MergeBranch(%q) must be rejected", name)
		}
		if err := RebaseBranch(t.TempDir(), name); err == nil {
			t.Errorf("RebaseBranch(%q) must be rejected", name)
		}
		if err := DeleteLocalBranch(t.TempDir(), name, true); err == nil {
			t.Errorf("DeleteLocalBranch(%q) must be rejected", name)
		}
	}
}

func TestGitContextUsesLongerTimeoutForNetworkCommands(t *testing.T) {
	deadline := func(args []string) time.Duration {
		ctx, cancel := gitContext(args)
		defer cancel()
		d, _ := ctx.Deadline()
		return time.Until(d)
	}
	if local, network := deadline([]string{"status"}), deadline([]string{"fetch", "origin"}); network <= local {
		t.Fatalf("i comandi di rete devono avere più tempo: local=%v network=%v", local, network)
	}
}
