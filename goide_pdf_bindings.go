package main

func (g *GoIDE) ReadProjectPDF(sessionID, path string) (string, error) {
	return g.service.ReadProjectPDF(sessionID, path)
}
