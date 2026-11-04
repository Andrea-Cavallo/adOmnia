package eclipsepde

import (
	"archive/zip"
	"context"
	"crypto/md5" // #nosec G501 -- the fake repository publishes MD5 like Kepler does
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fakeP2Content = `<?xml version='1.0' encoding='UTF-8'?>
<repository name='fake' type='org.eclipse.equinox.internal.p2.metadata.repository.LocalMetadataRepository' version='1'>
<units size='6'>
  <unit id='app.feature.group' version='1.0.0'>
    <provides size='1'><provided namespace='org.eclipse.equinox.p2.iu' name='app.feature.group' version='1.0.0'/></provides>
    <requires size='3'>
      <required namespace='org.eclipse.equinox.p2.iu' name='a.bundle' range='[1.0.0,1.0.0]'/>
      <required namespace='org.eclipse.equinox.p2.iu' name='other.os' range='[1.0.0,1.0.0]'>
        <filter>(&amp;(osgi.os=amigaos)(osgi.ws=none))</filter>
      </required>
      <required namespace='org.eclipse.equinox.p2.iu' name='config.a' match='providedCapabilities.exists(x | x.name == $0)' matchParameters='[a]'/>
    </requires>
  </unit>
  <unit id='a.bundle' version='1.0.0'>
    <provides size='2'>
      <provided namespace='org.eclipse.equinox.p2.iu' name='a.bundle' version='1.0.0'/>
      <provided namespace='osgi.bundle' name='a.bundle' version='1.0.0'/>
    </provides>
    <requires size='3'>
      <required namespace='java.package' name='dep.pkg' range='[1.0.0,2.0.0)'/>
      <required namespace='java.package' name='javax.xml.parsers' range='0.0.0'/>
      <required namespace='java.package' name='never.there' range='0.0.0' optional='true'/>
    </requires>
    <artifacts size='1'><artifact classifier='osgi.bundle' id='a.bundle' version='1.0.0'/></artifacts>
  </unit>
  <unit id='dep.bundle' version='1.2.0'>
    <provides size='2'>
      <provided namespace='org.eclipse.equinox.p2.iu' name='dep.bundle' version='1.2.0'/>
      <provided namespace='java.package' name='dep.pkg' version='1.2.0'/>
    </provides>
    <artifacts size='1'><artifact classifier='osgi.bundle' id='dep.bundle' version='1.2.0'/></artifacts>
  </unit>
  <unit id='dep.bundle' version='1.5.0'>
    <provides size='2'>
      <provided namespace='org.eclipse.equinox.p2.iu' name='dep.bundle' version='1.5.0'/>
      <provided namespace='java.package' name='dep.pkg' version='1.5.0'/>
    </provides>
    <artifacts size='1'><artifact classifier='osgi.bundle' id='dep.bundle' version='1.5.0'/></artifacts>
  </unit>
  <unit id='other.os' version='1.0.0'>
    <provides size='1'><provided namespace='org.eclipse.equinox.p2.iu' name='other.os' version='1.0.0'/></provides>
    <artifacts size='1'><artifact classifier='osgi.bundle' id='other.os' version='1.0.0'/></artifacts>
  </unit>
  <unit id='raw.version' version='raw:1.2.3'/>
</units>
</repository>`

var fakeBundles = map[string]string{
	"a.bundle_1.0.0":   "Bundle-ManifestVersion: 2\nBundle-SymbolicName: a.bundle\nBundle-Version: 1.0.0\nImport-Package: dep.pkg;version=\"[1.0,2.0)\"\n",
	"dep.bundle_1.2.0": "Bundle-ManifestVersion: 2\nBundle-SymbolicName: dep.bundle\nBundle-Version: 1.2.0\nExport-Package: dep.pkg;version=\"1.2.0\"\n",
	"dep.bundle_1.5.0": "Bundle-ManifestVersion: 2\nBundle-SymbolicName: dep.bundle\nBundle-Version: 1.5.0\nExport-Package: dep.pkg;version=\"1.5.0\"\n",
	"other.os_1.0.0":   "Bundle-ManifestVersion: 2\nBundle-SymbolicName: other.os\nBundle-Version: 1.0.0\n",
}

// writeFakeP2Repository builds a composite repository with one child: content in
// a jar, artifacts as plain XML with Kepler-style mapping rules and MD5 sums.
// corrupt names a bundle whose published checksum is wrong.
func writeFakeP2Repository(t *testing.T, corrupt string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "repo")
	child := filepath.Join(root, "child")
	writeText(t, filepath.Join(root, "compositeContent.xml"), "<repository><children size='1'><child location='child'/></children></repository>")
	writeText(t, filepath.Join(root, "compositeArtifacts.xml"), "<repository><children size='1'><child location='child'/></children></repository>")
	writeZip(t, filepath.Join(child, "content.jar"), "content.xml", fakeP2Content)
	var artifacts strings.Builder
	artifacts.WriteString(`<repository><mappings size='2'>
<rule filter='(&amp; (classifier=osgi.bundle) (format=packed))' output='${repoUrl}/plugins/${id}_${version}.jar.pack.gz'/>
<rule filter='(&amp; (classifier=osgi.bundle))' output='${repoUrl}/plugins/${id}_${version}.jar'/>
</mappings><artifacts>`)
	for name, manifest := range fakeBundles {
		jar := filepath.Join(child, "plugins", name+".jar")
		writeJar(t, jar, manifest)
		data, err := os.ReadFile(jar)
		if err != nil {
			t.Fatal(err)
		}
		sum := md5.Sum(data) // #nosec G401 -- see the import
		checksum := hex.EncodeToString(sum[:])
		if name == corrupt {
			checksum = strings.Repeat("0", 32)
		}
		id, version, _ := strings.Cut(name, "_")
		artifacts.WriteString("<artifact classifier='osgi.bundle' id='" + id + "' version='" + version + "'><properties><property name='download.md5' value='" + checksum + "'/></properties></artifact>")
		// The packed twin must be ignored.
		artifacts.WriteString("<artifact classifier='osgi.bundle' id='" + id + "' version='" + version + "'><processing size='1'><step id='org.eclipse.equinox.p2.processing.Pack200Unpacker' required='true'/></processing><properties><property name='format' value='packed'/></properties></artifact>")
	}
	artifacts.WriteString("</artifacts></repository>")
	writeText(t, filepath.Join(child, "artifacts.xml"), artifacts.String())
	return root
}

func writeText(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeZip(t *testing.T, path, entry, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	archive := zip.NewWriter(file)
	writer, err := archive.Create(entry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
}

func fakeCatalog(t *testing.T) *p2Catalog {
	t.Helper()
	units, skipped, err := parseP2Units([]byte(fakeP2Content))
	if err != nil {
		t.Fatal(err)
	}
	if skipped != 1 {
		t.Fatalf("the raw: version unit must be skipped, skipped = %d", skipped)
	}
	return newP2Catalog(units)
}

func bundleNames(keys []p2ArtifactKey) string {
	names := make([]string, 0, len(keys))
	for _, key := range keys {
		names = append(names, key.ID+"_"+key.Version)
	}
	return strings.Join(names, " ")
}

func TestP2SlicerTakesOnlyStrictFeatureContents(t *testing.T) {
	plan := resolveP2Location(fakeCatalog(t), P2Location{IncludeMode: "slicer", Units: []P2Unit{{ID: "app.feature.group", Version: "1.0.0"}}})
	if got := bundleNames(plan.Bundles); got != "a.bundle_1.0.0" {
		t.Fatalf("slicer bundles = %q", got)
	}
	if len(plan.Problems) != 0 {
		t.Fatalf("problems = %v", plan.Problems)
	}
}

func TestP2PlannerFollowsRequirementsAndPicksNewest(t *testing.T) {
	plan := resolveP2Location(fakeCatalog(t), P2Location{Units: []P2Unit{{ID: "app.feature.group", Version: "0.0.0"}}})
	// dep.pkg comes from the newest exporter; the JRE package, the optional one and
	// the unit filtered to another OS are not problems.
	if got := bundleNames(plan.Bundles); got != "a.bundle_1.0.0 dep.bundle_1.5.0" {
		t.Fatalf("planner bundles = %q", got)
	}
	if len(plan.Problems) != 0 {
		t.Fatalf("problems = %v", plan.Problems)
	}
}

func TestP2AllPlatformsIncludesFilteredUnits(t *testing.T) {
	plan := resolveP2Location(fakeCatalog(t), P2Location{IncludeMode: "slicer", IncludeAllPlatforms: true, Units: []P2Unit{{ID: "app.feature.group"}}})
	if got := bundleNames(plan.Bundles); got != "a.bundle_1.0.0 other.os_1.0.0" {
		t.Fatalf("bundles = %q", got)
	}
}

func TestP2MissingRootAndRequirementAreReported(t *testing.T) {
	plan := resolveP2Location(fakeCatalog(t), P2Location{Units: []P2Unit{{ID: "nothing"}, {ID: "dep.bundle", Version: "9.0.0"}}})
	if len(plan.Bundles) != 0 || len(plan.Problems) != 2 {
		t.Fatalf("plan = %+v", plan)
	}
}

// fakeTargetWorkspace is a project whose .target installs app.feature.group
// from the fake repository, with a workspace bundle importing dep.pkg.
func fakeTargetWorkspace(t *testing.T, repository string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "ws")
	writeProject(t, root, "com.acme.app", "Bundle-ManifestVersion: 2\nBundle-SymbolicName: com.acme.app\nBundle-Version: 1.0.0\nRequire-Bundle: a.bundle\nImport-Package: dep.pkg;version=\"[1.4,2)\"\n", nil)
	writeText(t, filepath.Join(root, "kepler.target"), `<?xml version="1.0" encoding="UTF-8"?>
<target name="kepler" sequenceNumber="1"><locations>
<location includeMode="planner" includeAllPlatforms="false" includeSource="false" type="InstallableUnit">
<unit id="app.feature.group" version="0.0.0"/>
<repository location="`+"file://"+filepath.ToSlash(repository)+`/"/>
</location></locations></target>`)
	if _, err := SetTarget(root, filepath.Join(root, "kepler.target")); err != nil {
		t.Fatal(err)
	}
	return root
}

func useTempP2Cache(t *testing.T) string {
	t.Helper()
	cache := t.TempDir()
	original := p2CacheRoot
	p2CacheRoot = func() (string, error) { return cache, nil }
	t.Cleanup(func() { p2CacheRoot = original; InvalidateTargetIndex("") })
	return cache
}

func TestDownloadTargetP2IndexesTheBundlesOffline(t *testing.T) {
	cache := useTempP2Cache(t)
	root := fakeTargetWorkspace(t, writeFakeP2Repository(t, ""))

	before, err := BuildReport(root)
	if err != nil {
		t.Fatal(err)
	}
	if before.Unresolved != 1 || !hasProblem(before.Problems, "not downloaded yet") {
		t.Fatalf("before download: %+v", before)
	}
	preview, err := PreviewTargetP2(root)
	if err != nil || preview.Units != 1 || len(preview.Repositories) != 1 || preview.Downloaded {
		t.Fatalf("preview = %+v %v", preview, err)
	}

	var phases []string
	result, err := DownloadTargetP2(context.Background(), root, func(progress P2Progress) { phases = append(phases, progress.Phase) })
	if err != nil {
		t.Fatal(err)
	}
	if result.Bundles != 2 || result.Downloaded != 2 || len(result.Problems) != 0 || len(phases) == 0 {
		t.Fatalf("result = %+v phases = %v", result, phases)
	}
	if !fileExists(filepath.Join(cache, "bundles", "dep.bundle_1.5.0.jar")) {
		t.Fatal("the bundle is not in the cache")
	}

	after, err := BuildReport(root)
	if err != nil {
		t.Fatal(err)
	}
	if after.Unresolved != 0 || after.TargetBundles != 2 || after.Bundles[0].Status != StatusResolved {
		t.Fatalf("after download: %+v", after)
	}

	again, err := DownloadTargetP2(context.Background(), root, nil)
	if err != nil || again.Reused != 2 || again.Downloaded != 0 {
		t.Fatalf("second download must reuse the cache: %+v %v", again, err)
	}
}

func TestDownloadTargetP2RejectsAWrongChecksum(t *testing.T) {
	cache := useTempP2Cache(t)
	root := fakeTargetWorkspace(t, writeFakeP2Repository(t, "dep.bundle_1.5.0"))
	result, err := DownloadTargetP2(context.Background(), root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Bundles != 1 || len(result.Problems) != 1 || !strings.Contains(result.Problems[0], "checksum") {
		t.Fatalf("result = %+v", result)
	}
	if fileExists(filepath.Join(cache, "bundles", "dep.bundle_1.5.0.jar")) {
		t.Fatal("a bundle with a wrong checksum must not reach the cache")
	}
}

func TestDownloadTargetP2NeedsATargetFile(t *testing.T) {
	useTempP2Cache(t)
	root, target := legacyWorkspace(t)
	if _, err := SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	if _, err := DownloadTargetP2(context.Background(), root, nil); err == nil {
		t.Fatal("a folder target has no p2 locations to download")
	}
}

func hasProblem(problems []Problem, text string) bool {
	for _, problem := range problems {
		if strings.Contains(problem.Message, text) {
			return true
		}
	}
	return false
}

func TestRepositoryURLAndChildren(t *testing.T) {
	if got := childURL("https://download.eclipse.org/releases/kepler", "../../technology/epp/packages/kepler/"); got != "https://download.eclipse.org/technology/epp/packages/kepler" {
		t.Fatalf("relative child = %q", got)
	}
	if got := childURL("https://a/b", "201402280900"); got != "https://a/b/201402280900" {
		t.Fatalf("child = %q", got)
	}
	if got := repositoryURL("https://download.eclipse.org/releases/kepler/"); got != "https://download.eclipse.org/releases/kepler" {
		t.Fatalf("url = %q", got)
	}
}

func TestLDAPFilter(t *testing.T) {
	env := map[string]string{"osgi.os": "linux", "osgi.ws": "gtk", "osgi.arch": "x86_64", "version": "1.5.0"}
	cases := []struct {
		filter string
		want   bool
	}{
		{"", true},
		{"(osgi.os=linux)", true},
		{"(&(osgi.os=linux)(osgi.arch=x86_64))", true},
		{"(& (osgi.os=linux) (osgi.ws=win32))", false},
		{"(|(osgi.os=win32)(osgi.os=linux))", true},
		{"(!(osgi.os=linux))", false},
		{"(osgi.arch=x86*)", true},
		{"(osgi.nl=*)", false},
		{"(version>=1.10.0)", false},
		{"(version<=1.10.0)", true},
		{"(osgi.os~=LINUX)", true},
		{"(&(classifier=osgi.bundle)(format=packed))", false},
	}
	for _, tc := range cases {
		text, want := tc.filter, tc.want
		filter, err := parseLDAPFilter(text)
		if err != nil {
			t.Fatalf("%q: %v", text, err)
		}
		if got := filter.matches(env); got != want {
			t.Errorf("%q = %v, want %v", text, got, want)
		}
	}
	for _, bad := range []string{"(", "(&)", "osgi.os=linux", "(!(a=1)(b=2))", "(a=1))"} {
		if _, err := parseLDAPFilter(bad); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
}

func TestTargetIndexCacheReusesAndInvalidates(t *testing.T) {
	InvalidateTargetIndex("")
	t.Cleanup(func() { InvalidateTargetIndex("") })
	directory := t.TempDir()
	writeJar(t, filepath.Join(directory, "plugins", "a.jar"), "Bundle-SymbolicName: a.bundle\nBundle-Version: 1.0.0\n")
	profile := TargetProfile{Name: "t", Kind: TargetLocalDirectory, Path: directory}

	first, err := cachedProfileIndex(profile)
	if err != nil {
		t.Fatal(err)
	}
	second, err := cachedProfileIndex(profile)
	if err != nil || second != first {
		t.Fatal("an unchanged target must reuse the cached index")
	}
	writeJar(t, filepath.Join(directory, "plugins", "b.jar"), "Bundle-SymbolicName: b.bundle\nBundle-Version: 1.0.0\n")
	third, err := cachedProfileIndex(profile)
	if err != nil || third == first || len(third.All()) != 2 {
		t.Fatalf("a new jar must rebuild the index: %v", err)
	}
	InvalidateTargetIndex(directory)
	fourth, err := cachedProfileIndex(profile)
	if err != nil || fourth == third {
		t.Fatal("an explicit invalidation must rebuild the index")
	}
}

func TestTargetIndexCacheIsBounded(t *testing.T) {
	InvalidateTargetIndex("")
	t.Cleanup(func() { InvalidateTargetIndex("") })
	for range maxCachedTargets + 3 {
		directory := t.TempDir()
		if _, err := cachedProfileIndex(TargetProfile{Kind: TargetLocalDirectory, Path: directory}); err != nil {
			t.Fatal(err)
		}
	}
	targetIndexCache.mu.Lock()
	defer targetIndexCache.mu.Unlock()
	if len(targetIndexCache.entries) != maxCachedTargets || len(targetIndexCache.order) != maxCachedTargets {
		t.Fatalf("cache size = %d/%d", len(targetIndexCache.entries), len(targetIndexCache.order))
	}
}

func TestCompositeChildFailureFollowsAtomicLoading(t *testing.T) {
	for _, atomic := range []bool{false, true} {
		repository := writeFakeP2Repository(t, "")
		value := "false"
		if atomic {
			value = "true"
		}
		writeText(t, filepath.Join(repository, "compositeContent.xml"), "<repository><properties><property name='p2.atomic.composite.loading' value='"+value+"'/></properties>"+
			"<children size='2'><child location='child'/><child location='gone'/></children></repository>")
		units := 0
		problems, err := walkP2Repository(context.Background(), newP2Fetcher(), "file://"+filepath.ToSlash(repository), "Content", func(_ string, data []byte) error {
			parsed, _, err := parseP2Units(data)
			units += len(parsed)
			return err
		})
		if atomic {
			if err == nil {
				t.Fatal("an atomic composite with a missing child must fail")
			}
			continue
		}
		if err != nil || units == 0 || len(problems) != 1 || !strings.Contains(problems[0], "gone") {
			t.Fatalf("non-atomic: units=%d problems=%v err=%v", units, problems, err)
		}
	}
}
