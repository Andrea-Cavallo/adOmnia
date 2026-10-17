package resources

import (
	"testing"
	"time"
)

func TestBudgetHysteresisAndCooldown(t *testing.T) {
	now := time.Now()
	b := NewMemoryBudget(1000)
	c := []BudgetCandidate{{ID: "old", Bytes: 400, Eligible: true, InactiveSince: now.Add(-time.Minute), StartedAt: now.Add(-time.Minute)}}
	if b.Choose(now, 999, c) != nil || b.Status().Pressure {
		t.Fatal("pressure below target")
	}
	if b.Choose(now, 1001, c) == nil {
		t.Fatal("over-budget candidate missing")
	}
	if b.Choose(now.Add(time.Second), 1200, c) != nil {
		t.Fatal("failed attempt was immediately retried")
	}
	b.Released(now)
	if b.Choose(now.Add(time.Second), 1200, c) != nil {
		t.Fatal("release storm during cooldown")
	}
	if b.Choose(now.Add(BudgetGrace), 900, c) == nil {
		t.Fatal("pressure cleared before recovery threshold")
	}
	if b.Choose(now.Add(2*BudgetGrace), 800, c) != nil || b.Status().Pressure {
		t.Fatal("pressure did not recover")
	}
	if b.Choose(now.Add(3*BudgetGrace), 950, c) != nil {
		t.Fatal("hysteresis reentered below high threshold")
	}
}

func TestBudgetProtectsBusyActiveAndRecentlyUsedResources(t *testing.T) {
	now := time.Now()
	b := NewMemoryBudget(1000)
	old := now.Add(-time.Hour)
	base := BudgetCandidate{Bytes: 200, Eligible: true, StartedAt: old, InactiveSince: old}
	candidates := []BudgetCandidate{base, base, base, base, base, base}
	candidates[0].Eligible = false // Active, busy, explicit or non-restorable owner.
	candidates[1].InactiveSince = now.Add(-time.Second)
	candidates[2].StartedAt = now.Add(-time.Second)
	candidates[5].StartedAt = time.Time{}
	candidates[3].InactiveSince = time.Time{} // Visible/unknown inactivity.
	candidates[4].Bytes = 0                   // Missing measurement is not a release estimate.
	if b.Choose(now, 2000, candidates) != nil {
		t.Fatal("protected resource selected")
	}
}

func TestBudgetChoosesOldestThenLargestWithStableTieBreak(t *testing.T) {
	now := time.Now()
	old := now.Add(-time.Hour)
	c := []BudgetCandidate{
		{ID: "recent", Bytes: 900, Eligible: true, InactiveSince: old.Add(time.Minute), StartedAt: old},
		{ID: "small", Bytes: 100, Eligible: true, InactiveSince: old, StartedAt: old},
		{ID: "b", Bytes: 500, Eligible: true, InactiveSince: old, StartedAt: old},
		{ID: "a", Bytes: 500, Eligible: true, InactiveSince: old, StartedAt: old},
	}
	if selected := NewMemoryBudget(1000).Choose(now, 2000, c); selected == nil || selected.ID != "a" {
		t.Fatalf("selection = %+v", selected)
	}
}

func TestAutomaticMemoryBudgetAndOverride(t *testing.T) {
	for _, test := range []struct{ total, expected uint64 }{{4 * 1024 * MiB, 1024 * MiB}, {16 * 1024 * MiB, 2048 * MiB}, {64 * 1024 * MiB, 3072 * MiB}} {
		if got := automaticMemoryBudget(test.total); got != test.expected {
			t.Fatalf("target = %d", got)
		}
	}
	t.Setenv("ADOMNIA_MEMORY_BUDGET_MIB", "768")
	if got, err := DefaultMemoryBudget(); err != nil || got != 768*MiB {
		t.Fatalf("override = %d %v", got, err)
	}
	for _, value := range []string{"0", "255", "65537", "-1", "oops"} {
		t.Setenv("ADOMNIA_MEMORY_BUDGET_MIB", value)
		if _, err := DefaultMemoryBudget(); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
}
