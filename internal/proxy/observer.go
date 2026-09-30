package proxy

import "sync/atomic"

// TrafficObserver sees each request the interceptor forwards while it is in
// flight. Started may return headers to add to the upstream request (the
// live development session adds its correlation id) and a function called
// with the outcome.
type TrafficObserver interface {
	Started(method, url string) (addHeaders map[string]string, done func(status int, errText string))
}

var trafficObserver atomic.Pointer[TrafficObserver]

// SetTrafficObserver installs the observer (nil removes it).
func SetTrafficObserver(observer TrafficObserver) {
	if observer == nil {
		trafficObserver.Store(nil)
		return
	}
	trafficObserver.Store(&observer)
}

func observeStart(method, url string) (map[string]string, func(int, string)) {
	observer := trafficObserver.Load()
	if observer == nil {
		return nil, func(int, string) {}
	}
	headers, done := (*observer).Started(method, url)
	if done == nil {
		done = func(int, string) {}
	}
	return headers, done
}
