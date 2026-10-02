package main

import "adomnia/internal/netpolicy"

// GetNetworkSettings restituisce modo offline, proxy e CA validi per tutta adOmnia.
func (a *App) GetNetworkSettings() netpolicy.Settings {
	return netpolicy.Current()
}

// SaveNetworkSettings valida e salva la politica di rete; vale subito per le nuove connessioni.
func (a *App) SaveNetworkSettings(settings netpolicy.Settings) (netpolicy.Settings, error) {
	return netpolicy.Save(settings)
}

// GetNetworkActivity elenca le connessioni che adOmnia ha aperto o bloccato da sola, dalla più recente.
func (a *App) GetNetworkActivity() []netpolicy.Event {
	return netpolicy.Activity()
}

// ClearNetworkActivity svuota il registro delle connessioni.
func (a *App) ClearNetworkActivity() {
	netpolicy.ClearActivity()
}
