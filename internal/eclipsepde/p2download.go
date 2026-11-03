package eclipsepde

import (
	"context"
	"crypto/md5" // #nosec G501 -- Kepler-era p2 repositories publish only MD5: it checks integrity against their metadata, not authenticity
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// p2DownloadWorkers is how many bundles download at once.
const p2DownloadWorkers = 4

// p2CacheRoot is the machine-wide folder of downloaded p2 bundles, shared by
// every project (a bundle id and version always name the same jar).
var p2CacheRoot = func() (string, error) {
	directory, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("no cache folder for p2 bundles: %w", err)
	}
	return filepath.Join(directory, "adOmnia", "eclipse-p2"), nil
}

// safeArtifactPart keeps file names built from repository data inside the cache.
var safeArtifactPart = regexp.MustCompile(`^[A-Za-z0-9._+-]+$`)

// P2Preview describes what DownloadTargetP2 would do, without network access.
type P2Preview struct {
	TargetPath   string   `json:"targetPath"`
	Locations    int      `json:"locations"`
	Units        int      `json:"units"`
	Repositories []string `json:"repositories"`
	// Downloaded is true when the bundles of this exact .target are in the cache.
	Downloaded bool `json:"downloaded"`
	Bundles    int  `json:"bundles"`
}

// P2Progress is one step of a download.
type P2Progress struct {
	Phase string `json:"phase"`
	Done  int    `json:"done"`
	Total int    `json:"total"`
}

// P2DownloadResult is the outcome of DownloadTargetP2.
type P2DownloadResult struct {
	Bundles    int      `json:"bundles"`
	Downloaded int      `json:"downloaded"`
	Reused     int      `json:"reused"`
	Problems   []string `json:"problems"`
}

// p2Lock records which cached jars a .target resolved to, keyed by the hash of
// the .target content: editing the file asks for a new download.
type p2Lock struct {
	Target   string   `json:"target"`
	Bundles  []string `json:"bundles"`
	Problems []string `json:"problems"`
}

// activeTargetDefinition returns the active profile when it is a .target file.
func activeTargetDefinition(root string) (string, *TargetDefinition, error) {
	settings, err := LoadTargetSettings(root)
	if err != nil {
		return "", nil, err
	}
	platform := NewTargetPlatform()
	platform.LoadFromSettings(absoluteProfiles(settings, root))
	profile, ok := platform.ActiveProfile()
	if !ok || profile.Kind != TargetEclipseDefinition {
		return "", nil, errors.New("the target platform is not a .target file: p2 locations come from a .target")
	}
	definition, err := ReadTargetDefinition(profile.Path)
	if err != nil {
		return "", nil, err
	}
	return profile.Path, definition, nil
}

// PreviewTargetP2 lists the repositories and units of the active .target.
func PreviewTargetP2(root string) (*P2Preview, error) {
	targetPath, definition, err := activeTargetDefinition(root)
	if err != nil {
		return nil, err
	}
	preview := &P2Preview{TargetPath: targetPath, Locations: len(definition.P2), Repositories: []string{}}
	seen := map[string]bool{}
	for _, location := range definition.P2 {
		preview.Units += len(location.Units)
		for _, repository := range location.Repositories {
			if !seen[repository] {
				seen[repository] = true
				preview.Repositories = append(preview.Repositories, repository)
			}
		}
	}
	if lock, ok := readP2Lock(targetPath); ok {
		preview.Downloaded, preview.Bundles = true, len(lock.Bundles)
	}
	return preview, nil
}

// DownloadTargetP2 resolves the p2 locations of the active .target and downloads
// their bundles into the machine cache, verifying the repository checksums. It
// runs only on explicit request; afterwards the target indexes offline.
func DownloadTargetP2(ctx context.Context, root string, progress func(P2Progress)) (*P2DownloadResult, error) {
	targetPath, definition, err := activeTargetDefinition(root)
	if err != nil {
		return nil, err
	}
	if len(definition.P2) == 0 {
		return nil, errors.New("the .target has no p2 (InstallableUnit) locations")
	}
	cache, err := p2CacheRoot()
	if err != nil {
		return nil, err
	}
	return downloadP2Locations(ctx, p2Job{fetcher: newP2Fetcher(), cache: cache, targetPath: targetPath, progress: progress}, definition.P2)
}

type p2Job struct {
	fetcher    p2Fetcher
	cache      string
	targetPath string
	progress   func(P2Progress)
}

func (j p2Job) report(phase string, done, total int) {
	if j.progress != nil {
		j.progress(P2Progress{Phase: phase, Done: done, Total: total})
	}
}

func downloadP2Locations(ctx context.Context, job p2Job, locations []P2Location) (*P2DownloadResult, error) {
	result := &P2DownloadResult{Problems: []string{}}
	var wanted []p2Wanted
	for index, location := range locations {
		job.report(fmt.Sprintf("Reading p2 location %d of %d", index+1, len(locations)), index, len(locations))
		found, problems, err := planP2Location(ctx, job.fetcher, location)
		if err != nil {
			return nil, err
		}
		wanted = append(wanted, found...)
		result.Problems = append(result.Problems, problems...)
	}
	bundles, err := fetchP2Bundles(ctx, job, wanted, result)
	if err != nil {
		return nil, err
	}
	result.Bundles = len(bundles)
	sort.Strings(result.Problems)
	if err := writeP2Lock(job.cache, job.targetPath, p2Lock{Target: job.targetPath, Bundles: bundles, Problems: result.Problems}); err != nil {
		return nil, err
	}
	InvalidateTargetIndex(job.targetPath)
	return result, nil
}

// p2Wanted is a bundle to fetch and where the repositories say it is.
type p2Wanted struct {
	key        p2ArtifactKey
	url        string
	properties map[string]string
}

// planP2Location reads the metadata and artifact repositories of a location,
// resolves its units and maps each bundle to a download URL.
func planP2Location(ctx context.Context, fetcher p2Fetcher, location P2Location) ([]p2Wanted, []string, error) {
	if len(location.Repositories) == 0 {
		return nil, []string{"a p2 location has no repository"}, nil
	}
	var units []*p2IU
	var artifacts []*p2ArtifactRepository
	var problems []string
	for _, repository := range location.Repositories {
		skipped, err := walkP2Repository(ctx, fetcher, repository, "Content", func(_ string, data []byte) error {
			parsed, _, err := parseP2Units(data)
			units = append(units, parsed...)
			return err
		})
		if err != nil {
			return nil, nil, err
		}
		problems = append(problems, skipped...)
		skipped, err = walkP2Repository(ctx, fetcher, repository, "Artifacts", func(url string, data []byte) error {
			parsed, err := parseP2Artifacts(url, data)
			if parsed != nil {
				artifacts = append(artifacts, parsed)
			}
			return err
		})
		if err != nil {
			return nil, nil, err
		}
		problems = append(problems, skipped...)
	}
	plan := resolveP2Location(newP2Catalog(units), location)
	problems = append(problems, plan.Problems...)
	var wanted []p2Wanted
	for _, key := range plan.Bundles {
		if item, ok := locateArtifact(artifacts, key); ok {
			wanted = append(wanted, item)
			continue
		}
		problems = append(problems, fmt.Sprintf("bundle %s %s is in the metadata but in no artifact repository", key.ID, key.Version))
	}
	return wanted, problems, nil
}

func locateArtifact(repositories []*p2ArtifactRepository, key p2ArtifactKey) (p2Wanted, bool) {
	for _, repository := range repositories {
		properties, ok := repository.artifacts[key]
		if !ok {
			continue
		}
		if url, ok := repository.locationOf(key); ok {
			return p2Wanted{key: key, url: url, properties: properties}, true
		}
	}
	return p2Wanted{}, false
}

// fetchP2Bundles downloads what is not cached yet, a few at a time. A failing
// bundle becomes a problem; a cancelled context stops everything.
func fetchP2Bundles(ctx context.Context, job p2Job, wanted []p2Wanted, result *P2DownloadResult) ([]string, error) {
	directory := filepath.Join(job.cache, "bundles")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return nil, err
	}
	var (
		mu      sync.Mutex
		done    int
		bundles []string
		wg      sync.WaitGroup
	)
	work := make(chan p2Wanted)
	for range p2DownloadWorkers {
		wg.Go(func() {
			for item := range work {
				file, reused, err := fetchP2Bundle(ctx, job.fetcher, directory, item)
				mu.Lock()
				done++
				switch {
				case err != nil:
					result.Problems = append(result.Problems, fmt.Sprintf("%s %s: %v", item.key.ID, item.key.Version, err))
				case reused:
					result.Reused++
					bundles = append(bundles, file)
				default:
					result.Downloaded++
					bundles = append(bundles, file)
				}
				job.report("Downloading bundles", done, len(wanted))
				mu.Unlock()
			}
		})
	}
	unique := map[p2ArtifactKey]bool{}
	for _, item := range wanted {
		if unique[item.key] {
			continue
		}
		unique[item.key] = true
		select {
		case work <- item:
		case <-ctx.Done():
		}
	}
	close(work)
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("p2 download stopped: %w", err)
	}
	sort.Strings(bundles)
	return bundles, nil
}

func fetchP2Bundle(ctx context.Context, fetcher p2Fetcher, directory string, item p2Wanted) (string, bool, error) {
	if !safeArtifactPart.MatchString(item.key.ID) || !safeArtifactPart.MatchString(item.key.Version) {
		return "", false, errors.New("unsafe bundle name in the repository")
	}
	file := filepath.Join(directory, item.key.ID+"_"+item.key.Version+".jar")
	if cachedBundleMatches(file, item.properties) {
		return file, true, nil
	}
	temporary, err := os.CreateTemp(directory, ".download-*")
	if err != nil {
		return "", false, err
	}
	defer func() { _ = os.Remove(temporary.Name()) }()
	digest, expected := checksumOf(item.properties)
	writer := io.Writer(temporary)
	if digest != nil {
		writer = io.MultiWriter(temporary, digest)
	}
	downloadErr := fetcher.download(ctx, item.url, maxP2ArtifactBytes, writer)
	closeErr := temporary.Close()
	if err := errors.Join(downloadErr, closeErr); err != nil {
		return "", false, err
	}
	if digest != nil && hex.EncodeToString(digest.Sum(nil)) != expected {
		return "", false, errors.New("checksum does not match the repository")
	}
	if err := os.Rename(temporary.Name(), file); err != nil {
		return "", false, err
	}
	return file, false, nil
}

// checksumOf prefers SHA-256 (newer p2) and falls back to MD5 (Kepler).
func checksumOf(properties map[string]string) (hash.Hash, string) {
	if value := properties["download.checksum.sha-256"]; value != "" {
		return sha256.New(), strings.ToLower(value)
	}
	if value := properties["download.md5"]; value != "" {
		return md5.New(), strings.ToLower(value) // #nosec G401 -- integrity check against the repository's own MD5
	}
	return nil, ""
}

// cachedBundleMatches trusts a cached jar whose size matches the repository
// (the content was verified when it was written).
func cachedBundleMatches(file string, properties map[string]string) bool {
	info, err := os.Stat(file)
	if err != nil {
		return false
	}
	size, err := strconv.ParseInt(properties["download.size"], 10, 64)
	return err != nil || size == info.Size()
}

func lockPath(cache, targetPath string) (string, error) {
	content, err := os.ReadFile(targetPath)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(content)
	return filepath.Join(cache, "resolutions", hex.EncodeToString(sum[:])+".json"), nil
}

func writeP2Lock(cache, targetPath string, lock p2Lock) error {
	file, err := lockPath(cache, targetPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	data, err := jsonutil.Marshal(lock)
	if err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o600)
}

// readP2Lock returns the download record of this exact .target content, if any.
func readP2Lock(targetPath string) (p2Lock, bool) {
	cache, err := p2CacheRoot()
	if err != nil {
		return p2Lock{}, false
	}
	file, err := lockPath(cache, targetPath)
	if err != nil {
		return p2Lock{}, false
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return p2Lock{}, false
	}
	var lock p2Lock
	if json.Unmarshal(data, &lock) != nil {
		return p2Lock{}, false
	}
	return lock, true
}

// downloadedP2Bundles lists the cached jars of the .target, for the index fingerprint.
func downloadedP2Bundles(targetPath string) []string {
	lock, ok := readP2Lock(targetPath)
	if !ok {
		return nil
	}
	return lock.Bundles
}
