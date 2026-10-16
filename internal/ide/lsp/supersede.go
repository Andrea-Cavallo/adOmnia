package lsp

import "context"

type requestKey struct{ uri, method string }
type latestRequest struct{ cancel context.CancelFunc }

// CallLatest is only for replaceable, read-only editor queries. Other methods
// (rename, formatting, commands) continue through Call and are never superseded.
func (c *Conn) CallLatest(ctx context.Context, uri, method string, params, result any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	entry := &latestRequest{cancel: cancel}
	key := requestKey{uri, method}
	c.mu.Lock()
	if c.latest == nil {
		c.latest = make(map[requestKey]*latestRequest)
	}
	if previous := c.latest[key]; previous != nil {
		previous.cancel()
	}
	c.latest[key] = entry
	c.mu.Unlock()
	defer func() {
		cancel()
		c.mu.Lock()
		if c.latest[key] == entry {
			delete(c.latest, key)
		}
		c.mu.Unlock()
	}()
	err := c.Call(ctx, method, params, result)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}

// CancelDocument invalidates replaceable reads when a buffer changes or closes.
func (c *Conn) CancelDocument(uri string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.latest {
		if key.uri == uri {
			entry.cancel()
			delete(c.latest, key)
		}
	}
}
