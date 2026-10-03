package dap

import (
	"io"
	"os"
)

type stdioStream struct {
	io.Reader
	io.Writer
	reader io.Closer
	writer io.Closer
}

func (s *stdioStream) Close() error {
	_ = s.writer.Close()
	return s.reader.Close()
}

func (m *DebugManager) waitAdapter(session *debugger) {
	err := session.command.Wait()
	_ = os.RemoveAll(session.buildDir)
	close(session.exited)
	reason := ""
	if err != nil {
		reason = "debug adapter terminato: " + err.Error()
	}
	m.terminate(session, reason)
}
