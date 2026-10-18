package java

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDescribeVersionsSkipsPreReleasesAndKeepsTheMajor(t *testing.T) {
	versions := []string{"2.14.0", "2.15.0", "2.15.1", "2.16.0-rc1", "2.16.0", "3.0.0-M1", "3.0.0", "3.1.0-SNAPSHOT"}
	info := describeVersions("a:b", "2.15.0", versions)
	if info.Latest != "3.0.0" || info.SameMajor != "2.16.0" || !info.Newer {
		t.Fatalf("%+v", info)
	}
	if latest := describeVersions("a:b", "3.0.0", versions); latest.Newer || latest.Latest != "3.0.0" {
		t.Fatalf("already on the newest stable: %+v", latest)
	}
}

func TestLookupVersionsReadsMetadataAndReportsMissingArtifacts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/org/acme/lib/maven-metadata.xml" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`<metadata><versioning><versions><version>1.0</version><version>1.1</version><version>2.0-beta1</version></versions></versioning></metadata>`))
	}))
	defer server.Close()
	previous := mavenCentralBase
	mavenCentralBase = server.URL
	t.Cleanup(func() { mavenCentralBase = previous })

	found := LookupVersions(context.Background(), map[string]string{"org.acme:lib": "1.0", "org.acme:missing": "1.0"})
	byKey := map[string]VersionInfo{}
	for _, info := range found {
		byKey[info.Key] = info
	}
	if lib := byKey["org.acme:lib"]; lib.Latest != "1.1" || !lib.Newer || lib.Error != "" {
		t.Fatalf("%+v", lib)
	}
	if byKey["org.acme:missing"].Error == "" {
		t.Fatalf("a missing artifact must report an error, got %+v", byKey["org.acme:missing"])
	}
}
