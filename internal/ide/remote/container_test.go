package remote

import "testing"

func TestContainerMountAndPortMapping(t *testing.T) {
	raw := []byte(`{"Name":"/service","State":{"Running":true},"Mounts":[{"Source":"/run/desktop/mnt/host/c/Projects","Destination":"/workspaces"}],"NetworkSettings":{"Ports":{"6060/tcp":[{"HostIp":"127.0.0.1","HostPort":"16060"}]}}}`)
	info, err := containerMapping(raw, `C:\Projects\Orders`)
	if err != nil || info.ProjectDirectory != "/workspaces/Orders" || info.Ports[0].Port != "16060" {
		t.Fatalf("%#v %v", info, err)
	}
	other, err := containerMapping(raw, `C:\Projects2\Orders`)
	if err != nil || other.ProjectDirectory != "" {
		t.Fatal("unrelated directory mapped", other, err)
	}
}
