//go:build windows

package process

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func handleCount(t *testing.T) uint32 {
	t.Helper()
	var count uint32
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetProcessHandleCount")
	ok, _, err := proc.Call(uintptr(windows.CurrentProcess()), uintptr(unsafe.Pointer(&count)))
	if ok == 0 {
		t.Fatal(err)
	}
	return count
}

func jobHelper(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestManagedHelperSleep$", "-test.count=1")
	cmd.Env = append(os.Environ(), "ADOMNIA_MANAGED_CHILD_HELPER=1")
	Configure(cmd, false)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	return cmd
}

func TestJobCloseCyclesReleaseChildrenAndHandles(t *testing.T) {
	// Warm up Windows syscall resolution before recording the baseline.
	job, err := newManagedJob()
	if err != nil {
		t.Fatal(err)
	}
	_ = windows.CloseHandle(job)
	var before uint32
	// Include os/exec runtime initialization in warmup, not in the leak delta.
	for i := 0; i < 15; i++ {
		if i == 3 {
			before = handleCount(t)
		}
		job, err := newManagedJob()
		if err != nil {
			t.Fatal(err)
		}
		child := jobHelper(t)
		if err := assignManagedJob(job, child.Process.Pid); err != nil {
			windows.CloseHandle(job)
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- child.Wait() }()
		if err := windows.CloseHandle(job); err != nil {
			t.Fatal(err)
		}
		select {
		case waitErr := <-done:
			_ = waitErr // the job kills the child: Wait reporting that is expected
		case <-time.After(5 * time.Second):
			t.Fatal("child survived job close")
		}
	}
	after := handleCount(t)
	t.Logf("12 cycles: handles %d -> %d", before, after)
	if after > before+2 {
		t.Fatalf("persistent handle growth: %d -> %d", before, after)
	}
}

// The owner deliberately exits without closing its job: the OS must clean up.
func TestManagedJobOwnerHelper(t *testing.T) {
	if os.Getenv("ADOMNIA_JOB_OWNER_HELPER") != "1" {
		t.Skip("subprocess helper")
	}
	SetManagedRegistry(OpenRegistry(""))
	child := jobHelper(t)
	RegisterManagedChild(child.Process.Pid, "helper")
	if managedJob.handle == 0 {
		t.Fatal("managed job was not initialized")
	}
	fmt.Println(child.Process.Pid)
	time.Sleep(5 * time.Minute)
}

func TestJobOwnerCrashTerminatesChild(t *testing.T) {
	owner := exec.Command(os.Args[0], "-test.run=^TestManagedJobOwnerHelper$", "-test.count=1")
	owner.Env = append(os.Environ(), "ADOMNIA_JOB_OWNER_HELPER=1")
	Configure(owner, false)
	stdout, err := owner.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := owner.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = owner.Process.Kill(); _ = owner.Wait() }()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("no ready child from owner")
	}
	pid, err := strconv.Atoi(scanner.Text())
	if err != nil {
		t.Fatal(err)
	}
	child, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(child)
	defer func() { _ = TerminateTreeByPID(pid) }()
	if err := owner.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	result, err := windows.WaitForSingleObject(child, 5000)
	if err != nil || result != windows.WAIT_OBJECT_0 {
		t.Fatalf("child survived owner crash: result=%d err=%v", result, err)
	}
}
