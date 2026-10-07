cask "adomnia" do
  version "__VERSION__"
  sha256 "__SHA256_MACOS__"

  url "https://github.com/Andrea-Cavallo/adOmnia/releases/download/v#{version}/adomnia-#{version}-macos-universal.dmg"
  name "adOmnia"
  desc "Local-first API developer toolbox"
  homepage "https://github.com/Andrea-Cavallo/adOmnia"

  app "adomnia.app"

  # macOS artifacts are currently unsigned/not notarized. Gatekeeper may warn on
  # first launch (right-click > Open). Remove this note once code signing lands.
end
