package main

import "adomnia/internal/ide/agentreview"

// AgentReview restituisce i file cambiati dagli agenti AI nel progetto e non ancora rivisti.
func (g *GoIDE) AgentReview(root string) agentreview.Review {
	return g.agentReview.Get(root)
}

// AcceptAgentFile tiene la versione dell'agente di un file.
func (g *GoIDE) AcceptAgentFile(root, path string) error {
	return g.agentReview.AcceptFile(root, path)
}

// RejectAgentFile riporta un file com'era prima dell'agente.
func (g *GoIDE) RejectAgentFile(root, path string) error {
	return g.agentReview.RejectFile(root, path)
}

// AcceptAllAgentChanges tiene tutte le modifiche dell'agente nel progetto.
func (g *GoIDE) AcceptAllAgentChanges(root string) error {
	return g.agentReview.AcceptAll(root)
}

// RejectAllAgentChanges riporta tutti i file del progetto com'erano prima dell'agente.
func (g *GoIDE) RejectAllAgentChanges(root string) error {
	return g.agentReview.RejectAll(root)
}

// AcceptAgentHunks registra i blocchi accettati: content è la versione di partenza che li include.
func (g *GoIDE) AcceptAgentHunks(root, path, content string) error {
	return g.agentReview.SetBaseline(root, path, content)
}

// RejectAgentHunks scrive content su disco solo se il file è ancora expected.
func (g *GoIDE) RejectAgentHunks(root, path, content, expected string) error {
	return g.agentReview.WriteCurrent(root, path, content, expected)
}
