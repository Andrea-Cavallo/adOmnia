package main

func (g *GoIDE) ReadProjectKeystore(sessionID, path string) (string, error) {
	return g.service.ReadProjectKeystore(sessionID, path)
}
