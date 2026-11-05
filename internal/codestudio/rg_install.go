package codestudio

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
)

// Downloadable ripgrep: release packages already bundle it, but a portable/dev build (or a user who
// wants a newer binary) can install it into the managed tools folder from the Installer dialog.
const (
	ripgrepRelease = "14.1.1"
	ripgrepBaseURL = "https://github.com/BurntSushi/ripgrep/releases/download/" + ripgrepRelease
)

type ripgrepAsset struct {
	file   string
	binary string
	sha256 string
}

// Hashes come from the release's published .sha256 files (Get-FileHash transcript), pinned here so a
// tampered download cannot be executed even if the checksum file were replaced too.
var ripgrepAssets = map[string]ripgrepAsset{
	"windows/amd64": {
		file: "ripgrep-14.1.1-x86_64-pc-windows-msvc.zip", binary: "rg.exe",
		sha256: "d0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1",
	},
	"linux/amd64": {
		file: "ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz", binary: "rg",
		sha256: "4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e",
	},
	"darwin/arm64": {
		file: "ripgrep-14.1.1-aarch64-apple-darwin.tar.gz", binary: "rg",
		sha256: "24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be",
	},
	"darwin/amd64": {
		file: "ripgrep-14.1.1-x86_64-apple-darwin.tar.gz", binary: "rg",
		sha256: "fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3",
	},
}

// RipgrepInstallable reports the download the Installer would perform on this machine.
func RipgrepInstallable() (string, bool) {
	asset, ok := ripgrepAssets[runtime.GOOS+"/"+runtime.GOARCH]
	return asset.file, ok
}

// InstallRipgrep downloads the pinned ripgrep into the managed tools folder, verifies its SHA-256
// and extracts only the binary. The search picks it up on the next call (RipgrepBinary checks the
// tools folder) without restarting the app.
func (s *Service) InstallRipgrep(ctx context.Context) (RipgrepInfo, error) {
	asset, ok := ripgrepAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		return RipgrepInfo{}, fmt.Errorf("no ripgrep build for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if s.toolsRoot == "" {
		return RipgrepInfo{}, fmt.Errorf("the managed tools folder is not configured")
	}
	destination := filepath.Join(s.toolsRoot, "bin")
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return RipgrepInfo{}, err
	}
	work, err := os.MkdirTemp("", "adomnia-ripgrep-")
	if err != nil {
		return RipgrepInfo{}, err
	}
	defer os.RemoveAll(work)
	archive := filepath.Join(work, asset.file)
	client := netpolicy.Client("tools", 2*time.Minute)
	if err := sdk.Download(ctx, client, "ripgrep", ripgrepBaseURL+"/"+asset.file, archive, asset.sha256, 64<<20, nil); err != nil {
		return RipgrepInfo{}, err
	}
	binary, err := extractRipgrepBinary(archive, asset.file, work, asset.binary)
	if err != nil {
		return RipgrepInfo{}, err
	}
	target := filepath.Join(destination, asset.binary)
	if err := os.WriteFile(target, binary, 0o755); err != nil {
		return RipgrepInfo{}, err
	}
	return s.RipgrepStatus(), nil
}

func extractRipgrepBinary(archive, name, work, binary string) ([]byte, error) {
	if filepath.Ext(name) == ".zip" {
		reader, err := zip.OpenReader(archive)
		if err != nil {
			return nil, fmt.Errorf("ripgrep: %w", err)
		}
		defer reader.Close()
		for _, entry := range reader.File {
			if filepath.Base(entry.Name) != binary {
				continue
			}
			opened, err := entry.Open()
			if err != nil {
				return nil, fmt.Errorf("ripgrep: %w", err)
			}
			defer opened.Close()
			return io.ReadAll(io.LimitReader(opened, 32<<20))
		}
		return nil, fmt.Errorf("ripgrep: %s not found in the archive", binary)
	}
	file, err := os.Open(archive)
	if err != nil {
		return nil, fmt.Errorf("ripgrep: %w", err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return nil, fmt.Errorf("ripgrep: %w", err)
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("ripgrep: %w", err)
		}
		if header.Name == "" || header.Typeflag != tar.TypeReg || filepath.Base(header.Name) != binary {
			continue
		}
		return io.ReadAll(io.LimitReader(reader, 32<<20))
	}
	return nil, fmt.Errorf("ripgrep: %s not found in the archive", binary)
}

var _ = http.StatusOK // keep net/http linked for the sdk.Download client contract documented above
