package codestudio

import (
	"fmt"
	"sync/atomic"
)

// directoryStreamFirstPage is how many entries the synchronous call returns: enough to paint the
// first rows immediately. The rest arrives in one event with the same stream id, so the UI can
// replace the first page with the complete sorted list without knowing any server-side generation.
const directoryStreamFirstPage = 250

// DirectoryStreamStart is the first page of a folder listing plus the stream that will complete it.
// Done is true when the whole listing fit in Entries and no event will follow.
type DirectoryStreamStart struct {
	StreamID     string      `json:"streamId"`
	RelativePath string      `json:"relativePath"`
	Entries      []FileEntry `json:"entries"`
	Done         bool        `json:"done"`
}

// DirectoryStreamChunk is the event payload that completes a listing started by StartDirectoryStream.
type DirectoryStreamChunk struct {
	StreamID     string      `json:"streamId"`
	RelativePath string      `json:"relativePath"`
	Entries      []FileEntry `json:"entries"`
	Done         bool        `json:"done"`
}

var directoryStreamSequence atomic.Uint64

// StartDirectoryStream returns the first page of a folder and, when the folder holds more, emits
// `directory.entries` with the complete sorted listing. Reading a folder is already bounded, so the
// win is the payload: the first rows do not wait for every entry to be serialized and parsed.
func (s *Service) StartDirectoryStream(sessionID, relativePath string, includeIgnored bool) (DirectoryStreamStart, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DirectoryStreamStart{}, err
	}
	entries, err := s.documents.ListDirectory(session.Project, relativePath, includeIgnored)
	if err != nil {
		return DirectoryStreamStart{}, err
	}
	if len(entries) <= directoryStreamFirstPage {
		return DirectoryStreamStart{RelativePath: relativePath, Entries: entries, Done: true}, nil
	}
	streamID := fmt.Sprintf("dir-%d", directoryStreamSequence.Add(1))
	first := append([]FileEntry(nil), entries[:directoryStreamFirstPage]...)
	// The goroutine only formats a value already read: it cannot outlive the request for long and
	// holds no file handle. An event that wins the race with the call response is buffered by the
	// frontend under its stream id.
	go s.emit("directory.entries", session.ID, streamID, DirectoryStreamChunk{
		StreamID: streamID, RelativePath: relativePath, Entries: entries, Done: true,
	})
	return DirectoryStreamStart{StreamID: streamID, RelativePath: relativePath, Entries: first, Done: false}, nil
}
