package browser

import "sync/atomic"

// NetworkObservation is one step of a page request: started, responded or failed.
type NetworkObservation struct {
	Kind      string
	RequestID string
	Method    string
	URL       string
	Status    int
	Error     string
}

var networkObserver atomic.Pointer[func(NetworkObservation)]

// SetNetworkObserver lets another backend service follow the page's requests
// (the live development session ties those hitting a local Go service to it).
func SetNetworkObserver(observer func(NetworkObservation)) {
	if observer == nil {
		networkObserver.Store(nil)
		return
	}
	networkObserver.Store(&observer)
}

func (b *BrowserDebug) notifyNetwork(observation NetworkObservation) {
	if observer := networkObserver.Load(); observer != nil && observation.RequestID != "" {
		(*observer)(observation)
	}
}
