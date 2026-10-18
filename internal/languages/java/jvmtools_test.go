package java

import "testing"

func TestParseJcmdListSkipsJcmdItself(t *testing.T) {
	output := "12044 org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run\r\n9020 com.acme.App --server.port=8081\r\n77 jdk.jcmd/sun.tools.jcmd.JCmd -l\r\n\r\nnot a line\r\n"
	found := ParseJcmdList(output)
	if len(found) != 2 || found[0].PID != 12044 || found[0].Args != "spring-boot:run" || found[1].MainClass != "com.acme.App" {
		t.Fatalf("found = %+v", found)
	}
}

func TestParseJstatGCSumsTheHeapAndKeepsGCTotals(t *testing.T) {
	output := "Timestamp        S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU    CCSC   CCSU   YGC     YGCT    FGC    FGCT     CGC    CGCT       GCT   \n" +
		"          10.6 1024.0 1024.0    0.0  512.0   8192.0   4096.0   20480.0    10240.0   5000.0  4800.0  600.0  550.0     7    0.031     2    0.150     0    0.000    0.181\n"
	sample, err := ParseJstatGC(output)
	if err != nil {
		t.Fatal(err)
	}
	if sample.HeapUsedKB != 512+4096+10240 || sample.HeapCapacityKB != 1024+1024+8192+20480 || sample.OldUsedKB != 10240 || sample.YoungUsedKB != 4608 {
		t.Fatalf("heap = %+v", sample)
	}
	if sample.YoungGCs != 7 || sample.FullGCs != 2 || sample.UptimeSeconds != 10.6 || sample.FullGCSeconds != 0.15 {
		t.Fatalf("gc = %+v", sample)
	}
}

func TestParseJstatGCRejectsUnexpectedOutput(t *testing.T) {
	for _, output := range []string{"", "Timestamp S0C\n1 2 3\n", "Timestamp S0C S1C S0U S1U EC EU OC\n1 2 3 4 5 6 7 8\n"} {
		if _, err := ParseJstatGC(output); err == nil {
			t.Fatalf("expected an error for %q", output)
		}
	}
}

func TestJFRRecordingNamesAreRestricted(t *testing.T) {
	if err := StopJFR("", 12, "adomnia-12; rm -rf"); err == nil {
		t.Fatal("a recording name outside adomnia-<pid> must be rejected before any process starts")
	}
	if _, _, err := StartJFR("", 0); err == nil {
		t.Fatal("pid 0 must be rejected")
	}
}
