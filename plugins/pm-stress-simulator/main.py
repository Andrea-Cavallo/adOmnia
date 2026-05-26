"""
PM Stress Simulator — adOmnia Python Plugin

Simula un Project Manager che chiede avanzamenti, aggiornamenti,
ETA, priorità e "solo una piccola modifica" mentre il developer prova a lavorare.

Dimostra l'uso del Python SDK: @action, streaming, storage, logging, events.
"""

import json
import random
import time
from typing import Generator

from adomnia import BaseWorker, action, log, api


# ─── Data ────────────────────────────────────────────────────────────────────

PM_INTROS = [
    "Ciao! Disturbo solo 30 secondi...",
    "Domandina veloce veloce:",
    "Quando hai un secondo, ma proprio un secondo:",
    "Non voglio metterti pressione, però",
    "Ti giro solo un micro-allineamento:",
    "Scusa se ti interrompo mentre sei in flow state, ma",
    "Ho una richiesta super easy, giuro:",
    "Mi ha scritto il business, quindi",
]

PROGRESS_QUESTIONS = [
    "a che punto siamo?",
    "hai aggiornamenti?",
    "riusciamo a chiuderla entro oggi?",
    "hai una percentuale di completamento?",
    "è bloccante o possiamo dire che è quasi done?",
    "posso dire agli stakeholder che siamo al 90%?",
    "mi dai una stima realistica ma ottimista?",
    "c'è qualcosa che posso fare per sbloccarti, tipo fissarti altri meeting?",
]

PM_PHRASES = [
    "Mi serve solo capire se è una cosa da 5 minuti.",
    "Non è urgente, però mi serve prima possibile.",
    "Possiamo fare una call di 15 minuti per allinearci?",
    "Ho aggiunto una persona in copia così resta aggiornata.",
    "Il requisito è cambiato leggermente, ma dovrebbe essere semplice.",
    "La demo è domani, ma tranquillo.",
    "Secondo me lato backend è praticamente già fatto.",
    "Dobbiamo solo renderlo un po' più wow.",
    "Non serve farlo perfetto, basta che sia production-ready.",
    "Ho creato una card nuova, ma è collegata a questa.",
]

STAKEHOLDER_MESSAGES = [
    "Il business chiede se possiamo anticipare la consegna.",
    "Lo sponsor vorrebbe vedere qualcosa già in pre-demo.",
    "Il cliente dice che prima funzionava.",
    "Management chiede visibilità giornaliera.",
    "Il referente funzionale ha detto che è solo un cambio label.",
    "Security chiede una review, ma dovrebbe essere una formalità.",
    "UX vorrebbe fare un piccolo redesign completo.",
]

MEETING_TITLES = [
    "Quick sync avanzamento",
    "Allineamento volante",
    "Mini call super rapida",
    "War room serena",
    "Checkpoint non bloccante",
    "Rituale di sincronizzazione asincrona sincrona",
    "Micro refinement urgente",
]

MOOD_LEVELS = {
    "friendly": {
        "emoji": "🙂",
        "pressure": 1,
        "closing": "Grazie mille, sei un grande!"
    },
    "corporate": {
        "emoji": "📊",
        "pressure": 3,
        "closing": "Resto in attesa di un tuo cortese riscontro."
    },
    "chaotic": {
        "emoji": "🚨",
        "pressure": 5,
        "closing": "Mi serve una risposta appena puoi, anche adesso."
    },
    "legendary": {
        "emoji": "🔥",
        "pressure": 10,
        "closing": "Ho già detto che è tutto sotto controllo."
    }
}


def _pick(items):
    return random.choice(items)


def _safe_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


# ─── Worker ──────────────────────────────────────────────────────────────────

class Worker(BaseWorker):
    """PM Stress Simulator worker."""

    def on_init(self, config: dict):
        settings = config.get("settings", {})
        self.mood = settings.get("pm_mood", "chaotic")
        self.follow_up_count = _safe_int(settings.get("follow_up_count", 5), 5)
        self.meeting_mode = bool(settings.get("meeting_mode", True))
        self.stakeholder_noise = bool(settings.get("stakeholder_noise", True))
        self.history_limit = _safe_int(settings.get("history_limit", 20), 20)

        if self.mood not in MOOD_LEVELS:
            self.mood = "chaotic"

        log.info(
            "PM Stress Simulator initialized",
            mood=self.mood,
            follow_up_count=self.follow_up_count,
            meeting_mode=self.meeting_mode,
            stakeholder_noise=self.stakeholder_noise,
        )

        try:
            raw_history = api.storage.get("pm_stress_history")
            self.history = json.loads(raw_history) if raw_history else []
        except Exception:
            self.history = []

    def on_shutdown(self):
        log.info("PM Stress Simulator shutting down. Reminder: hai aggiornamenti?")

    # ── Internal helpers ─────────────────────────────────────────────────

    def _save_history(self, event: dict):
        self.history.append(event)
        if len(self.history) > self.history_limit:
            self.history = self.history[-self.history_limit:]
        api.storage.set("pm_stress_history", json.dumps(self.history))

    def _pm_context(self):
        return MOOD_LEVELS.get(self.mood, MOOD_LEVELS["chaotic"])

    def _compose_message(self, task: str, intensity: int = None) -> dict:
        context = self._pm_context()
        pressure = intensity if intensity is not None else context["pressure"]

        message_parts = [
            f"{context['emoji']} {_pick(PM_INTROS)} {task}: {_pick(PROGRESS_QUESTIONS)}",
            _pick(PM_PHRASES),
        ]

        if self.stakeholder_noise:
            message_parts.append(_pick(STAKEHOLDER_MESSAGES))

        if self.meeting_mode and pressure >= 3:
            message_parts.append(f"Nel dubbio ho messo una call: '{_pick(MEETING_TITLES)}'.")

        message_parts.append(context["closing"])

        return {
            "task": task,
            "mood": self.mood,
            "pressure_level": pressure,
            "message": " ".join(message_parts),
            "requires_reply": True,
            "suggested_reply": "Sto verificando, ti aggiorno appena ho un dato solido.",
            "pm_confidence": random.choice(["altissima", "ingiustificata", "basata su sensazioni", "da roadmap"]),
        }

    # ── Actions ──────────────────────────────────────────────────────────

    @action("ask_update")
    def ask_update(self, payload: dict) -> dict:
        """Genera una richiesta di avanzamento in stile PM."""
        task = payload.get("task", "la task aperta")
        intensity = payload.get("intensity")

        result = self._compose_message(task, intensity)
        self._save_history({
            "type": "ask_update",
            "task": task,
            "mood": self.mood,
            "ts": time.time(),
            "message": result["message"],
        })

        api.emit("pm_stress.update.requested", {
            "task": task,
            "mood": self.mood,
            "pressure_level": result["pressure_level"],
        })

        log.info("Generated PM update request", task=task, mood=self.mood)

        return result

    @action("ask_update_stream", streaming=True)
    def ask_update_stream(self, payload: dict) -> Generator[dict, None, None]:
        """Versione streaming: il PM scrive mentre il developer perde concentrazione."""
        task = payload.get("task", "la task aperta")
        context = self._pm_context()

        chunks = [
            f"{context['emoji']} Ciao, hai 2 minuti?",
            f"Stavo guardando la card '{task}'...",
            "Non voglio metterti pressione.",
            "Però mi chiedevano un avanzamento.",
            "Secondo te possiamo dire che è quasi chiusa?",
            "Anche una percentuale va bene.",
        ]

        if self.stakeholder_noise:
            chunks.append(_pick(STAKEHOLDER_MESSAGES))

        if self.meeting_mode:
            chunks.append(f"Intanto ho messo una call: '{_pick(MEETING_TITLES)}'.")

        chunks.extend([
            "Mi basta una risposta veloce.",
            "Anzi, quando puoi mandami anche ETA, rischi, next step e blocker.",
            "Grazie mille 🙏",
        ])

        for index, message in enumerate(chunks):
            time.sleep(0.2)
            yield {
                "chunk": index + 1,
                "total": len(chunks),
                "message": message,
                "developer_focus": max(0, 100 - ((index + 1) * 9)),
                "progress": round(((index + 1) / len(chunks)) * 100),
            }

        self._save_history({
            "type": "ask_update_stream",
            "task": task,
            "mood": self.mood,
            "ts": time.time(),
            "chunks": len(chunks),
        })

        yield {
            "chunk": len(chunks) + 1,
            "total": len(chunks),
            "message": "✅ Follow-up completato. Il developer ora non ricorda più cosa stava facendo.",
            "developer_focus": 0,
            "progress": 100,
            "final": True,
        }

    @action("generate_followups")
    def generate_followups(self, payload: dict) -> dict:
        """Genera una sequenza di follow-up sempre più insistenti."""
        task = payload.get("task", "la task aperta")
        count = _safe_int(payload.get("count", self.follow_up_count), self.follow_up_count)
        count = max(1, min(count, 20))

        followups = []
        for index in range(count):
            pressure = min(10, index + self._pm_context()["pressure"])
            followups.append({
                "step": index + 1,
                "delay": random.choice(["dopo 3 minuti", "dopo 12 minuti", "subito dopo il tuo ultimo messaggio", "durante la pausa pranzo"]),
                "pressure_level": pressure,
                "message": self._compose_message(task, pressure)["message"],
            })

        result = {
            "task": task,
            "total_followups": len(followups),
            "followups": followups,
            "final_status": "Il PM ora chiede se serve una call per capire perché non hai risposto.",
        }

        self._save_history({
            "type": "generate_followups",
            "task": task,
            "count": count,
            "ts": time.time(),
        })

        api.emit("pm_stress.followups.generated", {
            "task": task,
            "count": count,
        })

        return result

    @action("meeting_invite")
    def meeting_invite(self, payload: dict) -> dict:
        """Genera un invito meeting non necessario ma molto urgente."""
        topic = payload.get("topic", "allinearci sugli avanzamenti")
        duration = random.choice([15, 30, 45, 60])
        attendees = payload.get("attendees", ["developer", "PM", "stakeholder silenzioso"])

        agenda = [
            "Stato avanzamento",
            "Bloccanti percepiti",
            "Rischi non ancora rischiosi",
            "Prossimi step",
            "Varie ed eventuali diventate urgenti",
        ]

        if self.stakeholder_noise:
            agenda.append("Domande del business non presenti nei requisiti")

        result = {
            "title": _pick(MEETING_TITLES),
            "topic": topic,
            "duration_minutes": duration,
            "attendees": attendees,
            "agenda": agenda,
            "description": (
                "Meeting rapido per allinearci. "
                "Non dovrebbe servire preparazione, ma porta ETA, demo, metriche, rischi e piano B."
            ),
            "developer_impact": random.choice([
                "perdita totale del context switching",
                "mezza giornata bruciata",
                "ritorno al codice con paura",
                "nuova task generata durante il meeting",
            ]),
        }

        self._save_history({
            "type": "meeting_invite",
            "topic": topic,
            "duration": duration,
            "ts": time.time(),
        })

        return result

    @action("status_report")
    def status_report(self, payload: dict) -> dict:
        """Crea un report PM-friendly partendo da dati minimi."""
        task = payload.get("task", "la task aperta")
        real_status = payload.get("status", "sto lavorando")
        blocker = payload.get("blocker", "nessun blocker ufficiale, solo requisiti mobili")

        green_words = [
            "in progress",
            "sotto controllo",
            "in validazione tecnica",
            "in allineamento",
            "in fase di consolidamento",
        ]

        return {
            "task": task,
            "real_status": real_status,
            "pm_status": _pick(green_words),
            "traffic_light": random.choice(["🟢", "🟡", "🟡 tendente al verde", "verde comunicabile"]),
            "blocker": blocker,
            "stakeholder_summary": (
                f"La lavorazione '{task}' procede. "
                "Sono in corso verifiche tecniche e allineamenti per garantire una consegna coerente."
            ),
            "next_steps": [
                "chiudere sviluppo",
                "fare test",
                "capire cosa voleva davvero il requisito",
                "preparare una demo che sembri stabile",
            ],
            "risk": random.choice([
                "scope creep",
                "call non pianificate",
                "requisito interpretato via chat",
                "ambiente di test posseduto da spiriti legacy",
            ]),
        }

    @action("get_history")
    def get_history(self, payload: dict = None) -> dict:
        """Restituisce lo storico degli stress PM generati."""
        return {
            "total": len(self.history),
            "history": self.history,
        }


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    Worker.serve()
