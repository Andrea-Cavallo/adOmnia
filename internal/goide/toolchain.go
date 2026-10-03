package goide

import (
	"adomnia/internal/ide/project"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/languages/golang"
)

// L'SDK Go vive nell'adapter (internal/languages/golang); questi alias tengono stabili i nomi usati
// dal Service, dalla persistenza e dai binding Wails durante la migrazione multi-language.
type (
	ToolchainConfiguration  = golang.ToolchainConfiguration
	ToolchainInfo           = golang.ToolchainInfo
	ToolchainTiming         = golang.ToolchainTiming
	ToolchainSettings       = golang.ToolchainSettings
	ToolchainManager        = golang.ToolchainManager[SessionID]
	ToolchainInstaller      = golang.ToolchainInstaller
	ToolchainRelease        = golang.ToolchainRelease
	InstalledToolchain      = golang.InstalledToolchain
	InstallToolchainRequest = golang.InstallToolchainRequest
	ToolchainInstallation   = golang.ToolchainInstallation
	GoplsInfo               = golang.GoplsInfo
	DelveInfo               = golang.DelveInfo
	LanguageServerSettings  = golang.GoplsSettings
)

func NewToolchainManager() *ToolchainManager { return golang.NewToolchainManager[SessionID]() }

var (
	NewToolchainInstaller  = golang.NewToolchainInstaller
	binaryStamp            = sdk.BinaryStamp
	samePath               = project.SamePath
	executableName         = sdk.ExecutableName
	withDefaultEnvironment = sdk.WithDefaultEnvironment
)

func goplsExecutableName() string { return sdk.ExecutableName("gopls") }

// validEnvironmentName è condiviso da run configuration e strumenti di build.
var validEnvironmentName = sdk.ValidEnvironmentName
