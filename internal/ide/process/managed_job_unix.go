//go:build !windows

package process

// Unix process groups already provide tree termination; registry sweep covers crashes.
func containManagedChild(pid int) {}
