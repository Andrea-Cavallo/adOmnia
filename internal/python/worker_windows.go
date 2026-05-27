//go:build windows

package python

import (
	"fmt"
	"log"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// applyMemoryLimit creates a Windows Job Object with a process memory limit
// and assigns the given process to it. This enforces MemoryMB at OS level.
func applyMemoryLimit(cmd *exec.Cmd, memoryMB int) (windows.Handle, error) {
	if memoryMB <= 0 {
		return 0, nil
	}

	jobName := fmt.Sprintf("adomnia_plugin_%d", cmd.Process.Pid)
	jobNamePtr, err := windows.UTF16PtrFromString(jobName)
	if err != nil {
		return 0, fmt.Errorf("failed to create job name: %w", err)
	}

	job, err := windows.CreateJobObject(nil, jobNamePtr)
	if err != nil {
		return 0, fmt.Errorf("failed to create job object: %w", err)
	}

	// Set the process memory limit
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_PROCESS_MEMORY
	info.ProcessMemoryLimit = uintptr(memoryMB) * 1024 * 1024

	_, err = windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		windows.CloseHandle(job)
		return 0, fmt.Errorf("failed to set job memory limit: %w", err)
	}

	// Open the process handle and assign to job
	processHandle, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(cmd.Process.Pid),
	)
	if err != nil {
		windows.CloseHandle(job)
		return 0, fmt.Errorf("failed to open process handle: %w", err)
	}
	defer windows.CloseHandle(processHandle)

	err = windows.AssignProcessToJobObject(job, processHandle)
	if err != nil {
		windows.CloseHandle(job)
		return 0, fmt.Errorf("failed to assign process to job object: %w", err)
	}

	log.Printf("[python-worker] memory limit set: %d MB (job=%s, pid=%d)", memoryMB, jobName, cmd.Process.Pid)
	return job, nil
}

// enforceWorkerMemoryLimit applies OS-level memory enforcement to a spawned worker process.
func enforceWorkerMemoryLimit(cmd *exec.Cmd, memoryMB int) {
	if cmd == nil || cmd.Process == nil {
		return
	}

	_, err := applyMemoryLimit(cmd, memoryMB)
	if err != nil {
		log.Printf("[python-worker] WARNING: failed to enforce memory limit: %v", err)
	}
}
