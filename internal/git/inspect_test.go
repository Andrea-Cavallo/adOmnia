package git

import "testing"

func TestAzureDevOpsDeepLinks(t *testing.T) {
	base := remoteWebBase("git@ssh.dev.azure.com:v3/acme/platform/widgets")
	if base != "https://dev.azure.com/acme/platform/_git/widgets" {
		t.Fatalf("unexpected Azure SSH web base: %q", base)
	}

	httpsBase := "https://dev.azure.com/acme/platform/_git/widgets"
	if got := commitURLForBase(httpsBase, "abc123"); got != httpsBase+"/commit/abc123" {
		t.Fatalf("unexpected Azure commit URL: %q", got)
	}
	want := httpsBase + "/branchCompare?baseVersion=GBfeature%2Fapi&targetVersion=GBmain&_a=commits"
	if got := compareURLForBase(httpsBase, "feature/api", "main"); got != want {
		t.Fatalf("unexpected Azure compare URL:\nwant %q\n got %q", want, got)
	}
}
