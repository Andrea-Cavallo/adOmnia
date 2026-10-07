class Adomnia < Formula
  desc "Local-first API developer toolbox"
  homepage "https://github.com/Andrea-Cavallo/adOmnia"
  version "__VERSION__"
  url "https://github.com/Andrea-Cavallo/adOmnia/releases/download/v#{version}/adomnia-#{version}-linux-amd64-gtk3-webkitgtk-4.1.tar.gz"
  sha256 "__SHA256_LINUX__"
  license "MIT"

  # The prebuilt binary links against GTK 3 and WebKitGTK 4.1. These are the
  # runtime libraries; adjust the formula names to your Linuxbrew tap if needed.
  depends_on "gtk+3"
  depends_on "webkit2gtk@4.1"

  def install
    bin.install "adomnia"
    prefix.install "adomnia.png" if File.exist?("adomnia.png")
  end

  test do
    assert_predicate bin/"adomnia", :exist?
  end
end
