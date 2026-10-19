//go:build windows

package process

import (
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// A single non-inheritable handle is held for the application lifetime. Windows
// closes it even on process termination; KILL_ON_JOB_CLOSE then stops members.
// Assignment is post-start, so descendants spawned before assignment still need
// the registry/tree-kill fallback. Independent updater/GUI processes are excluded.
var managedJob struct {
	once   sync.Once
	handle windows.Handle
}

func newManagedJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		_ = windows.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

func assignManagedJob(job windows.Handle, pid int) error {
	child, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(child) }()
	return windows.AssignProcessToJobObject(job, child)
}

func containManagedChild(pid int) {
	managedJob.once.Do(func() { managedJob.handle, _ = newManagedJob() })
	if managedJob.handle != 0 {
		_ = assignManagedJob(managedJob.handle, pid)
	}
}
