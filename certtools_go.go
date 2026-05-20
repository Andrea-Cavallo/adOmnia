package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func certJksSplitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "invalid multipart form: "+err.Error(), http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("jks")
	if err != nil {
		http.Error(w, "jks file required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	password := r.FormValue("password")
	if password == "" {
		password = "changeit"
	}
	alias := strings.TrimSpace(r.FormValue("alias"))

	keytool, err := exec.LookPath("keytool")
	if err != nil {
		http.Error(w, "keytool not found in PATH. Install a JDK and retry.", http.StatusFailedDependency)
		return
	}
	openssl, err := exec.LookPath("openssl")
	if err != nil {
		http.Error(w, "openssl not found in PATH. Install OpenSSL and retry.", http.StatusFailedDependency)
		return
	}

	dir, err := os.MkdirTemp("", "adomnia-jks-*")
	if err != nil {
		http.Error(w, "temp dir failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(dir)

	jksPath := filepath.Join(dir, "input.jks")
	p12Path := filepath.Join(dir, "output.p12")
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")

	out, err := os.Create(jksPath)
	if err != nil {
		http.Error(w, "temp file failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := io.Copy(out, io.LimitReader(file, 32<<20)); err != nil {
		out.Close()
		http.Error(w, "failed to save upload: "+err.Error(), http.StatusBadRequest)
		return
	}
	out.Close()

	args := []string{
		"-importkeystore",
		"-srckeystore", jksPath,
		"-srcstoretype", "JKS",
		"-srcstorepass", password,
		"-destkeystore", p12Path,
		"-deststoretype", "PKCS12",
		"-deststorepass", password,
		"-destkeypass", password,
		"-noprompt",
	}
	if alias != "" {
		args = append(args, "-srcalias", alias, "-destalias", alias)
	}
	if output, err := exec.Command(keytool, args...).CombinedOutput(); err != nil {
		http.Error(w, fmt.Sprintf("keytool conversion failed: %s", strings.TrimSpace(string(output))), http.StatusBadRequest)
		return
	}

	if output, err := exec.Command(openssl, "pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-out", certPath, "-passin", "pass:"+password).CombinedOutput(); err != nil {
		http.Error(w, fmt.Sprintf("certificate export failed: %s", strings.TrimSpace(string(output))), http.StatusBadRequest)
		return
	}
	if output, err := exec.Command(openssl, "pkcs12", "-in", p12Path, "-nocerts", "-nodes", "-out", keyPath, "-passin", "pass:"+password).CombinedOutput(); err != nil {
		http.Error(w, fmt.Sprintf("key export failed: %s", strings.TrimSpace(string(output))), http.StatusBadRequest)
		return
	}

	certPEM, _ := os.ReadFile(certPath)
	keyPEM, _ := os.ReadFile(keyPath)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"fileName": header.Filename,
		"certPem":  string(certPEM),
		"keyPem":   string(keyPEM),
		"createdAt": time.Now().UTC().Format(time.RFC3339),
		"warning":  "Private keys are extracted locally only. Protect the downloaded PEM files.",
	})
}
