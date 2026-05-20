#
# build.ps1 - Multi-platform build script for adOmnia (Windows PowerShell)
#
# Usage:
#   .\build.ps1                     # Build current platform only
#   .\build.ps1 -Target all         # Build all platforms
#   .\build.ps1 -Target windows     # Build Windows only
#   .\build.ps1 -Target all -Version "1.0.0"  # Build all with version
#

param(
    [string]$Target = "current",
    [string]$Version = "dev",
    [switch]$Compress,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Configuration
$BuildDir = "dist"
$BuildDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$GitCommit = try { (git rev-parse --short HEAD 2>$null) } catch { "unknown" }

# Colors (for PowerShell 5.1+ with VT100 support)
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Show-Header {
    Write-Host ""
    Write-ColorOutput Cyan "╔════════════════════════════════════════╗"
    Write-ColorOutput Cyan "║     adOmnia Build Script v$Version        ║"
    Write-ColorOutput Cyan "╚════════════════════════════════════════╝"
    Write-Host ""
}

function Show-Help {
    Write-Host @"
adOmnia Build Script for Windows

USAGE:
    .\build.ps1 [-Target <target>] [-Version <version>] [-Compress]

PARAMETERS:
    -Target     Build target (default: current)
                  current   Build for current platform
                  all       Build for all platforms
                  windows   Build Windows binaries
                  macos     Build macOS binaries (requires cross-compile tools)
                  linux     Build Linux binaries (requires cross-compile tools)
    
    -Version    Version number (default: dev)
    
    -Compress   Compress binaries with UPX (if installed)
    
    -Help       Show this help message

EXAMPLES:
    .\build.ps1
    .\build.ps1 -Target all -Version "1.0.0"
    .\build.ps1 -Target windows -Compress
    .\build.ps1 -Target current -Version "1.2.3"

"@
    exit 0
}

if ($Help) {
    Show-Help
}

Show-Header

# Check Go installation
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-ColorOutput Red "❌ Error: Go is not installed"
    Write-Host "Download from: https://golang.org/dl/"
    exit 1
}

$GoVersion = (go version) -replace "go version ", ""
Write-ColorOutput Green "✓ Go version: $GoVersion"
Write-ColorOutput Green "✓ Build version: $Version"
Write-ColorOutput Green "✓ Git commit: $GitCommit"

# M6: Check CGO/toolchain for the target platform
function Check-Toolchain {
    param([string]$GOOS, [string]$GOARCH)
    Write-ColorOutput Yellow "→ Checking toolchain for $GOOS/$GOARCH..."

    # Check Go minimum version
    $gover = (go version) -replace "go version go(\d+\.\d+).*", '$1'
    if ([version]$gover -lt [version]"1.22") {
        Write-ColorOutput Red "❌ Go 1.22+ required. Current: $gover"
        Write-Host "  Download: https://go.dev/dl/"
        return $false
    }

    switch ($GOOS) {
        "windows" {
            # Check if gcc is available for Windows CGO builds
            $gcc = Get-Command gcc -ErrorAction SilentlyContinue
            if (-not $gcc) {
                Write-ColorOutput Yellow "⚠️  gcc not found. Install MinGW-w64 or TDM-GCC for Windows CGO builds."
                Write-Host "  TDM-GCC: https://jmeubank.github.io/tdm-gcc/"
                Write-Host "  MinGW-w64: https://www.mingw-w64.org/"
            } else {
                Write-ColorOutput Green "  ✓ gcc: $(gcc --version | Select-Object -First 1)"
            }
        }
        "darwin" {
            if ($IsMacOS -or $IsLinux) {
                $xcode = Get-Command xcode-select -ErrorAction SilentlyContinue
                if (-not $xcode) {
                    Write-ColorOutput Yellow "⚠️  Xcode tools not found (needed for CGO on macOS)"
                    Write-Host "  Run: xcode-select --install"
                }
            } else {
                Write-ColorOutput Yellow "⚠️  Cross-compiling to macOS from non-macOS — ensure CGO toolchain is configured"
            }
        }
        "linux" {
            # Check if cross-compiler or native GCC is available
            $gcc = Get-Command gcc -ErrorAction SilentlyContinue
            if (-not $gcc) {
                Write-ColorOutput Yellow "⚠️  gcc not found. For Linux builds with CGO, install build-essential."
                Write-Host "  On the Linux host: sudo apt-get install build-essential"
                Write-Host "  WebKitGTK: sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev"
            }
        }
    }
    return $true
}

Write-Host ""

# Build flags
$BaseLdflags = "-s -w"
$VersionLdflags = "$BaseLdflags -X main.Version=$Version -X main.BuildDate=$BuildDate -X main.GitCommit=$GitCommit"

# Clean build directory
function Clean-BuildDir {
    Write-ColorOutput Yellow "🗑️  Cleaning previous builds..."
    if (Test-Path $BuildDir) {
        Remove-Item -Recurse -Force $BuildDir
    }
    New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
}

# Build Windows
function Build-Windows {
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Cyan "🪟  Building for Windows..."
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if (-not (Check-Toolchain "windows" "amd64")) {
        Write-ColorOutput Red "✗ Toolchain check failed — skipping Windows build"
        return $false
    }
    
    # Windows AMD64
    Write-ColorOutput Yellow "→ Building Windows AMD64..."
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "1"
    
    $Output = "$BuildDir\adomnia-windows-amd64.exe"
    
    try {
        go build -ldflags "$VersionLdflags -H windowsgui" -o $Output .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $Output).Length / 1MB
            Write-ColorOutput Green "✓ adomnia-windows-amd64.exe ($([math]::Round($Size, 2)) MB)"
        } else {
            Write-ColorOutput Red "✗ Windows AMD64 build failed"
            return $false
        }
    } catch {
        Write-ColorOutput Red "✗ Windows AMD64 build failed: $_"
        return $false
    }
    
    # Windows 386 (optional)
    Write-ColorOutput Yellow "→ Building Windows 386..."
    $env:GOARCH = "386"
    $Output386 = "$BuildDir\adomnia-windows-386.exe"
    
    try {
        go build -ldflags "$VersionLdflags -H windowsgui" -o $Output386 .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $Output386).Length / 1MB
            Write-ColorOutput Green "✓ adomnia-windows-386.exe ($([math]::Round($Size, 2)) MB)"
        }
    } catch {
        Write-ColorOutput Yellow "⚠️  Windows 386 build skipped"
    }
    
    return $true
}

# Build macOS
function Build-MacOS {
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Cyan "🍎  Building for macOS..."
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if (-not (Check-Toolchain "darwin" "amd64")) {
        Write-ColorOutput Red "✗ Toolchain check failed — skipping macOS build"
        return $false
    }
    
    # macOS AMD64
    Write-ColorOutput Yellow "→ Building macOS Intel (AMD64)..."
    $env:GOOS = "darwin"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "1"
    
    $Output = "$BuildDir\adomnia-darwin-amd64"
    
    try {
        go build -ldflags "$VersionLdflags" -o $Output .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $Output).Length / 1MB
            Write-ColorOutput Green "✓ adomnia-darwin-amd64 ($([math]::Round($Size, 2)) MB)"
        }
    } catch {
        Write-ColorOutput Yellow "⚠️  macOS AMD64 build failed (cross-compilation may not be configured)"
        return $false
    }
    
    # macOS ARM64
    Write-ColorOutput Yellow "→ Building macOS Apple Silicon (ARM64)..."
    $env:GOARCH = "arm64"
    $OutputARM = "$BuildDir\adomnia-darwin-arm64"
    
    try {
        go build -ldflags "$VersionLdflags" -o $OutputARM .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $OutputARM).Length / 1MB
            Write-ColorOutput Green "✓ adomnia-darwin-arm64 ($([math]::Round($Size, 2)) MB)"
        }
    } catch {
        Write-ColorOutput Yellow "⚠️  macOS ARM64 build failed"
    }
    
    return $true
}

# Build Linux
function Build-Linux {
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Cyan "🐧  Building for Linux..."
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if (-not (Check-Toolchain "linux" "amd64")) {
        Write-ColorOutput Red "✗ Toolchain check failed — skipping Linux build"
        return $false
    }
    
    # Linux AMD64
    Write-ColorOutput Yellow "→ Building Linux AMD64..."
    $env:GOOS = "linux"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "0"  # Disable CGO for simpler cross-compilation
    
    $Output = "$BuildDir\adomnia-linux-amd64"
    
    try {
        go build -ldflags "$VersionLdflags" -o $Output .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $Output).Length / 1MB
            Write-ColorOutput Green "✓ adomnia-linux-amd64 ($([math]::Round($Size, 2)) MB)"
        }
    } catch {
        Write-ColorOutput Yellow "⚠️  Linux AMD64 build failed"
        return $false
    }
    
    # Linux ARM64
    Write-ColorOutput Yellow "→ Building Linux ARM64..."
    $env:GOARCH = "arm64"
    $OutputARM = "$BuildDir\adomnia-linux-arm64"
    
    try {
        go build -ldflags "$VersionLdflags" -o $OutputARM .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $OutputARM).Length / 1MB
            Write-ColorOutput Green "✓ adomnia-linux-arm64 ($([math]::Round($Size, 2)) MB)"
        }
    } catch {
        Write-ColorOutput Yellow "⚠️  Linux ARM64 build failed"
    }
    
    return $true
}

# Build current platform
function Build-Current {
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Cyan "🔨  Building for current platform..."
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    $env:CGO_ENABLED = "1"
    $Output = "$BuildDir\adomnia.exe"
    
    Write-ColorOutput Yellow "→ Building for Windows (current)..."
    
    try {
        go build -ldflags "$VersionLdflags -H windowsgui" -o $Output .
        
        if ($LASTEXITCODE -eq 0) {
            $Size = (Get-Item $Output).Length / 1MB
            Write-ColorOutput Green "✓ adomnia.exe ($([math]::Round($Size, 2)) MB)"
            return $true
        } else {
            Write-ColorOutput Red "✗ Build failed"
            return $false
        }
    } catch {
        Write-ColorOutput Red "✗ Build failed: $_"
        return $false
    }
}

# Compress binaries with UPX
function Compress-Binaries {
    if (-not (Get-Command upx -ErrorAction SilentlyContinue)) {
        Write-ColorOutput Yellow "⚠️  UPX not found, skipping compression"
        Write-Host "   Download from: https://upx.github.io/"
        return
    }
    
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Cyan "📦  Compressing binaries with UPX..."
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    Get-ChildItem "$BuildDir\adomnia-*" | ForEach-Object {
        Write-ColorOutput Yellow "→ Compressing $($_.Name)..."
        upx --best --lzma $_.FullName 2>&1 | Select-String "(compressed|Ratio)"
    }
}

# Create checksums
function Create-Checksums {
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Cyan "🔐  Generating checksums..."
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    $Checksums = @()
    
    Get-ChildItem "$BuildDir\adomnia-*" | ForEach-Object {
        $Hash = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash
        $Checksums += "$Hash  $($_.Name)"
    }
    
    $Checksums | Out-File -FilePath "$BuildDir\SHA256SUMS.txt" -Encoding ASCII
    Write-ColorOutput Green "✓ SHA256SUMS.txt created"
}

# Show summary
function Show-Summary {
    Write-Host ""
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-ColorOutput Green "✅  Build Complete!"
    Write-ColorOutput Cyan "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Host ""
    Write-ColorOutput Cyan "Artifacts:"
    Get-ChildItem $BuildDir | Format-Table Name, @{Label="Size (MB)"; Expression={[math]::Round($_.Length / 1MB, 2)}}
    Write-Host ""
    Write-ColorOutput Cyan "Next steps:"
    Write-Host "  • Test binaries on target platforms"
    Write-ColorOutput Yellow "  • Create GitHub release: gh release create v$Version .\dist\*"
    Write-Host "  • Update CHANGELOG.md"
    Write-Host ""
}

# Main execution
Clean-BuildDir

switch ($Target.ToLower()) {
    "all" {
        Build-Windows | Out-Null
        Build-MacOS | Out-Null
        Build-Linux | Out-Null
        
        if ($Compress) {
            Compress-Binaries
        }
        
        Create-Checksums
    }
    "windows" {
        Build-Windows | Out-Null
        
        if ($Compress) {
            Compress-Binaries
        }
        
        Create-Checksums
    }
    "macos" {
        Build-MacOS | Out-Null
        Create-Checksums
    }
    "linux" {
        Build-Linux | Out-Null
        Create-Checksums
    }
    "current" {
        if (Build-Current) {
            Create-Checksums
        } else {
            exit 1
        }
    }
    default {
        Write-ColorOutput Red "❌ Unknown target: $Target"
        Write-Host ""
        Write-Host "Usage: .\build.ps1 [-Target <target>] [-Version <version>]"
        Write-Host ""
        Write-Host "Targets: current, all, windows, macos, linux"
        Write-Host "Use -Help for more information"
        exit 1
    }
}

Show-Summary
