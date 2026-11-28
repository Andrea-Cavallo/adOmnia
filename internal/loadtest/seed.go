package loadtest

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	mathrand "math/rand/v2"
	"time"
)

// iterationRand is the random source of iteration i of VU v: derived from the seed alone, so
// a rerun with the same seed gives that iteration the same think time, row and uuid, whatever
// the scheduling. Not for secrets.
func iterationRand(seed uint64, vu, iteration int) *mathrand.Rand {
	return mathrand.New(mathrand.NewPCG(seed, uint64(vu)<<32|uint64(uint32(iteration)))) //nolint:gosec // test data, not a secret
}

// newSeed picks the seed of a run that did not set one.
func newSeed() uint64 {
	var b [8]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails on supported platforms
	return binary.LittleEndian.Uint64(b[:]) | 1
}

// thinkTime is the pause before iteration i of VU v.
func thinkTime(w Workload, vu, iteration int) time.Duration {
	ms := w.ThinkTimeMs
	if w.ThinkTimeMaxMs > w.ThinkTimeMs {
		ms += iterationRand(w.Seed, vu, iteration).IntN(w.ThinkTimeMaxMs - w.ThinkTimeMs + 1)
	}
	return time.Duration(ms) * time.Millisecond
}

// seededUUID is a v4 UUID from r.
func seededUUID(r *mathrand.Rand) string {
	var v [16]byte
	binary.LittleEndian.PutUint64(v[:8], r.Uint64())
	binary.LittleEndian.PutUint64(v[8:], r.Uint64())
	v[6] = (v[6] & 0x0f) | 0x40
	v[8] = (v[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", v[0:4], v[4:6], v[6:8], v[8:10], v[10:16])
}
