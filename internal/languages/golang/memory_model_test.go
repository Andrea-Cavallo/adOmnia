package golang

import (
	"strings"
	"testing"
)

func TestMemoryModel(t *testing.T) {
	report, _ := loadFixture(t, map[string]string{
		"go.mod": "module example.com/mm\n\ngo 1.22\n",
		"worker/worker.go": `package worker

import (
	"sync"
	"sync/atomic"
)

type Pool struct {
	mu      sync.Mutex
	jobs    chan int
	done    sync.WaitGroup
	handled atomic.Int64
	results []int
}

func (p *Pool) Start() {
	p.done.Add(1)
	go p.loop()
}

func (p *Pool) loop() {
	defer p.done.Done()
	for job := range p.jobs {
		p.mu.Lock()
		p.results = append(p.results, job)
		p.mu.Unlock()
		p.handled.Add(1)
	}
}

func (p *Pool) Submit(job int) { p.jobs <- job }

func (p *Pool) Stop() {
	close(p.jobs)
	p.done.Wait()
}

func (p *Pool) Leak() { p.mu.Lock() }
`,
	})
	kinds := map[string]int{}
	for _, op := range report.Syncs {
		kinds[op.Kind]++
	}
	for _, kind := range []string{"go", "send", "recv", "close", "lock", "unlock", "atomic", "wg-add", "wg-done", "wg-wait"} {
		if kinds[kind] == 0 {
			t.Fatalf("missing %s: %v", kind, kinds)
		}
	}
	groups := MemoryModel(report.Syncs, "example.com/mm/worker", "(*Pool).loop")
	byTarget := map[string]SyncGroup{}
	for _, group := range groups {
		byTarget[group.Target] = group
	}
	if byTarget["p.jobs"].Kind != "channel" || len(byTarget["p.jobs"].Edges) < 2 {
		t.Fatalf("channel group: %+v", byTarget["p.jobs"])
	}
	if mutex := byTarget["p.mu"]; mutex.Kind != "mutex" || !strings.Contains(strings.Join(mutex.Warnings, " "), "(*Pool).Leak locks p.mu") {
		t.Fatalf("mutex group: %+v", mutex)
	}
	if byTarget["p.done"].Kind != "waitgroup" || byTarget["p.handled"].Kind != "atomic" {
		t.Fatalf("groups: %+v", byTarget)
	}
	if text := MemoryModelText("(*Pool).loop", groups); !strings.Contains(text, "happens-before") {
		t.Fatal(text)
	}
}
