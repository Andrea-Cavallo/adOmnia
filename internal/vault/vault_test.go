package vault

import (
	"sync"
	"testing"
)

func TestStaleTimerCannotLockReopenedVault(t *testing.T) {
	t.Cleanup(lockVault)
	vaultMu.Lock()
	vaultUnlocked = true
	resetVaultTimerLocked()
	oldGeneration := vaultTimerGeneration
	lockVaultLocked()
	vaultUnlocked = true
	resetVaultTimerLocked()
	currentGeneration := vaultTimerGeneration
	vaultMu.Unlock()
	expireVaultTimer(oldGeneration)
	vaultMu.RLock()
	unlocked := vaultUnlocked
	vaultMu.RUnlock()
	if !unlocked {
		t.Fatal("stale timer locked the reopened vault")
	}
	expireVaultTimer(currentGeneration)
	vaultMu.RLock()
	unlocked = vaultUnlocked
	vaultMu.RUnlock()
	if unlocked {
		t.Fatal("current timer did not lock the vault")
	}
}

func TestTimeoutBounds(t *testing.T) {
	previous := TimeoutMinutes()
	t.Cleanup(func() { SetTimeoutMinutes(previous) })
	SetTimeoutMinutes(0)
	if TimeoutMinutes() != 1 {
		t.Fatal("timeout must be at least one minute")
	}
	SetTimeoutMinutes(121)
	if TimeoutMinutes() != 120 {
		t.Fatal("timeout must not exceed 120 minutes")
	}
}

func TestConcurrentTimeoutAndTimerReset(t *testing.T) {
	previous := TimeoutMinutes()
	t.Cleanup(func() { lockVault(); SetTimeoutMinutes(previous) })
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			for j := range 100 {
				SetTimeoutMinutes(1 + j%120)
				_ = TimeoutMinutes()
				vaultMu.Lock()
				vaultUnlocked = true
				resetVaultTimerLocked()
				vaultMu.Unlock()
				resetVaultTimer()
				lockVault()
			}
		})
	}
	workers.Wait()
}
