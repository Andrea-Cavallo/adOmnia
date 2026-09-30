package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

type recordingObserver struct {
	started []string
	status  int
}

func (o *recordingObserver) Started(method, url string) (map[string]string, func(int, string)) {
	o.started = append(o.started, method+" "+url)
	return map[string]string{"X-AdOmnia-Request-ID": "adm-1"}, func(status int, _ string) { o.status = status }
}

func TestInterceptorReportsInFlightRequestsAndAddsHeaders(t *testing.T) {
	var seen string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Get("X-AdOmnia-Request-ID")
		w.WriteHeader(http.StatusCreated)
	}))
	defer upstream.Close()
	observer := &recordingObserver{}
	SetTrafficObserver(observer)
	defer SetTrafficObserver(nil)

	request := httptest.NewRequest(http.MethodPut, upstream.URL+"/users/1", nil)
	recorder := httptest.NewRecorder()
	interceptHandler(recorder, request)

	if recorder.Code != http.StatusCreated || seen != "adm-1" {
		t.Fatalf("status %d, header %q", recorder.Code, seen)
	}
	if len(observer.started) != 1 || observer.started[0] != "PUT "+upstream.URL+"/users/1" || observer.status != http.StatusCreated {
		t.Fatalf("observer not called as expected: %+v", observer)
	}
}
