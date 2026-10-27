package preview

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// StaticOptions configura un server per file statici.
type StaticOptions struct {
	// Root è la cartella servita: nulla fuori da essa è raggiungibile, nemmeno via link simbolici.
	Root string
	// PreferredPort è la porta desiderata; se occupata se ne usa un'altra libera.
	PreferredPort int
	// SPAFallback serve index.html per i percorsi senza estensione che non esistono (router lato client).
	SPAFallback bool
}

// StaticServer ospita file statici su 127.0.0.1 e inietta il client di live reload nelle pagine HTML
// mentre le serve: i file su disco non vengono mai modificati.
type StaticServer struct {
	*hub
	root     string
	spa      bool
	server   *http.Server
	listener net.Listener
}

// StartStatic risolve la radice, apre il listener su loopback e comincia a servire.
func StartStatic(options StaticOptions) (*StaticServer, error) {
	root, err := filepath.EvalSymlinks(options.Root)
	if err != nil {
		return nil, fmt.Errorf("the folder to serve is not available: %w", err)
	}
	if info, statErr := os.Stat(root); statErr != nil || !info.IsDir() {
		return nil, errors.New("the path to serve is not a folder")
	}
	listener, err := listenLoopback(options.PreferredPort)
	if err != nil {
		return nil, err
	}
	s := &StaticServer{hub: newHub(listener.Addr().(*net.TCPAddr).Port), root: root, spa: options.SPAFallback, listener: listener}
	s.server = &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { _ = s.server.Serve(listener) }()
	return s, nil
}

// listenLoopback apre un listener su loopback, preferendo la porta indicata e ripiegando su una libera.
func listenLoopback(preferred int) (net.Listener, error) {
	port, err := FreePort(preferred)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(LoopbackHost, strconv.Itoa(port)))
	if err != nil {
		return nil, fmt.Errorf("could not listen on port %d: %w", port, err)
	}
	return listener, nil
}

// Port è la porta su cui il server ascolta.
func (s *StaticServer) Port() int { return s.port }

// URL è l'indirizzo base del sito.
func (s *StaticServer) URL() string { return baseURL(s.port) }

func baseURL(port int) string {
	return "http://" + net.JoinHostPort(LoopbackHost, strconv.Itoa(port)) + "/" // NOSONAR -- the preview server binds loopback only: plain http on 127.0.0.1
}

// Root è la cartella servita, risolta.
func (s *StaticServer) Root() string { return s.root }

// Close ferma il server e chiude i flussi di live reload.
func (s *StaticServer) Close() error {
	s.closeStreams()
	return shutdown(s.server, s.listener)
}

// shutdown ferma un http.Server e chiude comunque il listener: se Serve non è ancora partito,
// Shutdown non lo conosce e la porta resterebbe occupata.
func shutdown(server *http.Server, listener net.Listener) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	defer listener.Close()
	if err := server.Shutdown(ctx); err != nil {
		return server.Close()
	}
	return nil
}

// ServeHTTP implementa http.Handler.
func (s *StaticServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.allowedHost(r.Host) {
		http.Error(w, "forbidden host", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if s.serveLive(w, r) {
		return
	}
	s.serveFile(w, r)
}

func (s *StaticServer) serveFile(w http.ResponseWriter, r *http.Request) {
	resolved, status := s.resolve(r.URL.Path)
	if status == http.StatusNotFound && s.spa && path.Ext(r.URL.Path) == "" {
		resolved, status = s.resolve("/index.html")
	}
	if status != http.StatusOK {
		http.Error(w, http.StatusText(status), status)
		return
	}
	file, err := os.Open(resolved)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	if isHTML(resolved) && info.Size() <= maxInjectedBytes {
		s.serveHTML(w, r, file)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func (s *StaticServer) serveHTML(w http.ResponseWriter, r *http.Request, file *os.File) {
	content, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "could not read the page", http.StatusInternalServerError)
		return
	}
	content = injectLiveClient(content)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(content)
}

// resolve traduce un percorso URL in un file reale dentro la radice. Rifiuta i segmenti nascosti
// (.git, .env, .adomnia…), il path traversal e i link simbolici che escono dalla radice.
func (s *StaticServer) resolve(urlPath string) (string, int) {
	cleaned := path.Clean("/" + urlPath)
	if strings.Contains(cleaned, "..") || hasForbiddenSegment(cleaned) { // path.Clean already removed every ".." element: what is left is a hostile or odd name
		return "", http.StatusNotFound
	}
	candidate := filepath.Join(s.root, filepath.FromSlash(cleaned))
	real, err := filepath.EvalSymlinks(candidate) // NOSONAR -- candidate is path.Clean-ed and segment-checked above; the containment check below answers 404 for anything outside s.root, so the response never reveals which paths beyond the served folder exist (no filesystem oracle)
	if err != nil {
		return "", http.StatusNotFound
	}
	// s.root is already symlink-resolved and clean: the resolved target must be the root or strictly under it.
	// Out of the root answers exactly like a missing file (404): a 403 would tell a caller which paths outside the
	// served folder exist (filesystem oracle).
	if real != s.root && !strings.HasPrefix(real, s.root+string(filepath.Separator)) {
		return "", http.StatusNotFound
	}
	info, err := os.Stat(real) // #nosec G703 -- real is symlink-resolved and confined to s.root by the prefix check above
	if err != nil {
		return "", http.StatusNotFound
	}
	if info.IsDir() {
		return s.resolveIndex(real)
	}
	return real, http.StatusOK
}

// hasForbiddenSegment dice se un percorso URL pulito contiene un segmento nascosto (tranne
// .well-known) o con separatori/volumi di altri sistemi (backslash e :).
func hasForbiddenSegment(cleaned string) bool {
	for segment := range strings.SplitSeq(cleaned, "/") {
		if segment == "" {
			continue
		}
		if (strings.HasPrefix(segment, ".") && segment != ".well-known") || strings.ContainsAny(segment, "\\:") {
			return true
		}
	}
	return false
}

// resolveIndex risolve index.html dentro una cartella già confinata alla radice: anche il link
// simbolico dell'indice deve restare sotto la radice e puntare a un file regolare.
func (s *StaticServer) resolveIndex(dir string) (string, int) {
	realIndex, err := filepath.EvalSymlinks(filepath.Join(dir, "index.html"))
	if err != nil || !strings.HasPrefix(realIndex, s.root+string(filepath.Separator)) {
		return "", http.StatusNotFound
	}
	if indexInfo, statErr := os.Stat(realIndex); statErr == nil && indexInfo.Mode().IsRegular() { // #nosec G703 -- realIndex is symlink-resolved and confined to s.root by the prefix check above
		return realIndex, http.StatusOK
	}
	return "", http.StatusNotFound
}

func isHTML(path string) bool {
	extension := strings.ToLower(filepath.Ext(path))
	return extension == ".html" || extension == ".htm"
}
