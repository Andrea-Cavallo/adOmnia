"""
Sprint Ceremony Simulator — adOmnia Python Plugin

Simula tutte le cerimonie Agile con risultati satirici.
Dimostra: @action sync/streaming, storage, logging, api events.
"""

import time
import json
import random
import hashlib
from typing import Generator

from adomnia import BaseWorker, action, log, api

# ─── Corpora ─────────────────────────────────────────────────────────────────

BUZZWORDS = [
    "synergy", "alignment", "bandwidth", "deep-dive", "circle back",
    "low-hanging fruit", "move the needle", "north star", "pivot",
    "disrupt", "growth hacking", "scalable", "bleeding edge",
    "thought leadership", "ecosystem", "holistic", "robust",
    "best-in-class", "game changer", "unlock", "leverage",
    "streamline", "actionable insights", "delta", "velocity",
]

TASK_VERBS = [
    "refactoring del", "ottimizzazione del", "migrazione del",
    "investigazione sul", "allineamento sul", "documentazione del",
    "analisi del", "re-architettura del", "containerizzazione del",
]

TASK_NOUNS = [
    "sistema di autenticazione", "pipeline CI/CD", "monolite legacy",
    "microservizio payment", "database utenti", "message broker",
    "API Gateway", "servizio di notifiche", " modulo reporting",
    "layer di caching", "sistema di logging centralizzato",
]

BLOCKERS = [
    "Aspetto il code review da 3 giorni",
    "Il cluster staging e' down (di nuovo)",
    "DevOps deve approvare la PR #3847",
    "La pipeline fallisce su un test flaky che non ho scritto io",
    "Il product owner non ha ancora deciso il colore del pulsante",
    "Sto facendo knowledge transfer (nessuno ascolta)",
    "Devo allinearmi con il team di architettura",
    "La CI ha deciso che oggi non compila",
    "Sono in attesa delle API del team backend (che sono io)",
    "Il ticket Jira non ha abbastanza story points assegnati",
]

ADVICE = [
    "Facciamo un brainstorming asincrono su Miro",
    "Apriamo una spike qualche sprint",
    "Portiamolo in retro e parliamone",
    "Non e' una mia priorita' questo sprint",
    "Chiediamo al CTO se e' d'accordo",
    "Serve un RFC prima di procedere",
    "Documentiamolo su Confluence",
    "Portiamolo in refinement il prossimo sprint",
    "Facciamo un A/B test prima",
    "Devo verificare con legal (per sicurezza)",
]

RETRO_COLUMNS = [
    ("Start Doing", [
        "Scrivere test prima di scrivere codice (scherzo, mai)",
        "Fare pair programming (forzato, 8 ore al giorno)",
        "Aggiornare la wiki (nessuno la legge ma e' bello averla)",
        "Fare code review entro 24 ore (anziché 3 settimane)",
        "Documentare le decisioni architetturali (ADR che nessuno aprira')",
        "Usare i type hint in Python (finalmente, nel 2026)",
    ]),
    ("Stop Doing", [
        "Deployare di venerdi' pomeriggio alle 17:59",
        "Approvare PR senza leggerle (colpa di tutti)",
        "Usare `println` come sistema di logging",
        "Fare refactor 'tanto per' senza test",
        "Dire 'funziona sul mio computer' in call",
        "Mettere TODO nel codice senza ticket Jira associato",
    ]),
    ("Continue Doing", [
        "Ignorare i warning del compilatore (ormai e' tradizione)",
        "Sottostimare le task del 300% (planning poker strategico)",
        "Fare standup di 45 minuti (e' diventato un rito)",
        "Blame-are il developer che ha lasciato l'azienda 2 anni fa",
        "Usare Kafka anche quando basterebbe un file CSV",
        "Dire 'e' un problema di DNS' a ogni incident",
    ]),
]

PLANNING_CARDS = [
    (1,  "Banale, lo faccio durante lo standup"),
    (2,  "Un paio d'ore, se StackOverflow collabora"),
    (3,  "Una giornata, contando le interruzioni"),
    (5,  "Due-tre giorni, con annessa riunione di allineamento"),
    (8,  "Tutto lo sprint, ammesso che non ci siano bug"),
    (13, "Due sprint, perche' tocca rifare anche i test"),
    (21, "Un quarter intero, serve un RFC approvato dal CTO"),
    (89, "Riscriviamo tutto in Rust, assumiamo 3 persone"),
]

SENIORITY_TITLES = {
    "junior": "Junior Developer (livello: 'si, ma come si fa?')",
    "mid": "Mid Developer (livello: 'stackoverflow-driven development')",
    "senior": "Senior Developer (livello: 'it depends')",
    "staff_engineer": "Staff Engineer (livello: 'facciamo un RFC')",
    "principal": "Principal Engineer (livello: 'ho scritto io quel bug nel 2018')",
    "cto": "CTO (livello: 'quanto fatturiamo?' — non scrive codice dal 2015)",
}

SENIORITY_VAGUENESS = {
    "junior": 0, "mid": 1, "senior": 2,
    "staff_engineer": 3, "principal": 4, "cto": 5,
}

ACCEPTANCE_CRITERIA = [
    ("GIVEN un utente loggato", "WHEN clicca sul pulsante", "THEN succede qualcosa (non specificato cosa)"),
    ("GIVEN il sistema e' up", "WHEN la CI e' verde", "THEN il deploy funziona (teoricamente)"),
    ("GIVEN non e' venerdi'", "WHEN facciamo deploy", "THEN nessuno viene svegliato nel weekend"),
    ("GIVEN il product owner ha deciso", "WHEN il team ha capito", "THEN abbiamo gia' cambiato idea"),
    ("GIVEN il test flaky passa per caso", "WHEN apriamo la PR", "THEN mergiamo senza guardare"),
    ("GIVEN c'e' budget", "WHEN il CFO approva", "THEN possiamo comprare quel SaaS da $50K/anno"),
]


def _buzz(n: int = 2) -> str:
    return " ".join(f"**{w}**" for w in random.sample(BUZZWORDS, min(n, len(BUZZWORDS))))


def _pick(items):
    return items[hash(str(time.time())) % len(items)]


def _id() -> str:
    return hashlib.md5(str(time.time()).encode()).hexdigest()[:8]


# ─── Worker ──────────────────────────────────────────────────────────────────

class Worker(BaseWorker):

    def on_init(self, config: dict):
        s = config.get("settings", {})
        self.seniority = s.get("seniority_level", "staff_engineer")
        self.team_size = int(s.get("team_size", 8))
        self.buzzwords = s.get("include_buzzwords", True)
        self.session_standups: list[dict] = []
        log.info("Sprint Ceremony Simulator pronto",
                 seniority=self.seniority, team_size=self.team_size)
        try:
            saved = api.storage.get("ceremony_history")
            self.history = json.loads(saved) if saved else []
        except Exception:
            self.history = []

    def on_shutdown(self):
        log.info("Sprint concluso. Velocity: immaginaria. Morale: basso. Caffeina: alta.")

    # ── Actions ──────────────────────────────────────────────────────────

    @action("standup")
    def standup(self, payload: dict) -> dict:
        """Genera un aggiornamento standup gonfiato."""
        yesterday = payload.get("yesterday", "ho fixato un bug")
        today = payload.get("today", "continuo a fixare bug")
        blocker = payload.get("blocker", "")

        vagueness = SENIORITY_VAGUENESS[self.seniority]

        yesterday_bs = f"Ho fatto {_pick(TASK_VERBS)}{_pick(TASK_NOUNS)} per {_buzz(2) if self.buzzwords else 'migliorare la codebase'}"
        today_bs = f"Oggi mi occupo di {_pick(TASK_VERBS)}{_pick(TASK_NOUNS)} con focus su {_buzz(2) if self.buzzwords else 'qualita\''}"
        blocker_bs = blocker if blocker else _pick(BLOCKERS)

        # Più sei senior, più la risposta è vaga
        if vagueness >= 4:
            yesterday_bs = f"Varie attivita' strategiche di {_buzz(3)}. Non posso scendere nel dettaglio."
            today_bs = f"Allineamento cross-team su {_buzz(3)}. Meeting con stakeholder."
        elif vagueness >= 2:
            yesterday_bs += f" e altre attivita' trasversali"
            today_bs += f" + {vagueness} meeting"

        standup = {
            "developer": SENIORITY_TITLES[self.seniority],
            "yesterday": f"📅 Ieri: {yesterday_bs}",
            "today": f"🎯 Oggi: {today_bs}",
            "blocker": f"🚫 Blocker: {blocker_bs}",
            "vibe_check": _pick(["👍", "👍", "👍", "🤷", "😤", "☕"]),
        }

        self.session_standups.append(standup)
        if len(self.session_standups) > 20:
            self.session_standups = self.session_standups[-20:]
        api.storage.set("last_standup", json.dumps(standup))

        api.emit("ceremony.standup.generated", {
            "seniority": self.seniority,
            "has_blocker": bool(blocker),
        })

        return standup

    @action("planning_poker")
    def planning_poker(self, payload: dict) -> dict:
        """Genera stime di planning poker assurde."""
        task = payload.get("task", "implementare login")
        n_estimates = min(payload.get("estimates", self.team_size), len(PLANNING_CARDS))

        selected = random.sample(PLANNING_CARDS, n_estimates)
        team_members = [
            f"Sviluppatore {i+1} ({_pick(['Frontend', 'Backend', 'DevOps', 'Fullstack', 'Mobile', 'Data', 'Security', 'Platform'])} Team)"
            for i in range(n_estimates)
        ]

        estimates = []
        for i, (pts, meaning) in enumerate(selected):
            estimates.append({
                "member": team_members[i],
                "points": pts,
                "justification": meaning,
                "emoji": _pick(["🤔", "😬", "💀", "🚀", "🤡", "😎"]),
            })

        avg = sum(e["points"] for e in estimates) / len(estimates)
        real = round(avg * random.uniform(2.5, 5.0))

        result = {
            "task": task,
            "sprint": f"Sprint {random.randint(1, 50)}",
            "team_size": n_estimates,
            "estimates": estimates,
            "average_points": round(avg, 1),
            "consensus": f"{random.randint(5, 13)} SP (dopo {random.randint(15, 45)} minuti di discussione)",
            "reality_check": f"Tempo reale stimato: {real} giorni lavorativi ({real * 2} con meeting)",
            "scrum_master_comment": _pick(ADVICE),
        }

        self.history.append({"type": "planning", "task": task, "ts": time.time()})
        if len(self.history) > 50:
            self.history = self.history[-50:]
        api.storage.set("ceremony_history", json.dumps(self.history))

        return result

    @action("retro", streaming=True)
    def retro(self, payload: dict) -> Generator[dict, None, None]:
        """Genera retrospective con colonne Start/Stop/Continue (streaming)."""
        sprint = payload.get("sprint", f"Sprint {random.randint(1, 50)}")
        team_mood = payload.get("mood", _pick(["😤 frustrato", "😐 meh", "☕ stanco", "💀 burnout"]))

        yield {"phase": "intro", "message": f"📋 Retrospective — {sprint}", "progress": 5}
        time.sleep(0.2)
        yield {"phase": "mood", "message": f"Mood del team: {team_mood}", "progress": 10}
        time.sleep(0.2)

        items: dict[str, list[str]] = {}
        progress = 15
        for col_name, options in RETRO_COLUMNS:
            time.sleep(0.25)
            picked = random.sample(options, min(random.randint(2, 4), len(options)))
            items[col_name] = picked
            progress += 25
            yield {
                "phase": "column",
                "column": col_name,
                "items": picked,
                "progress": min(progress, 90),
            }

        time.sleep(0.3)
        action_items = [
            f"Action item {i+1}: {_pick(ADVICE).lower()} (owner: {_pick(['nessuno', 'tutti', 'chi ha perso a morra cinese', 'il nuovo arrivato', 'l\'intern'])} — due date: sprint prossimo)"
            for i in range(random.randint(2, 4))
        ]

        yield {
            "phase": "done",
            "sprint": sprint,
            "mood": team_mood,
            "columns": items,
            "action_items": action_items,
            "total_items": sum(len(v) for v in items.values()),
            "time_wasted_minutes": random.randint(45, 90),
            "actual_decisions_made": 0,
            "progress": 100,
            "final": True,
        }

    @action("jira_ticket")
    def jira_ticket(self, payload: dict) -> dict:
        """Genera un ticket Jira completo di acceptance criteria ridicoli."""
        summary = payload.get("summary", "Implementare la feature X")
        epic = payload.get("epic", "")

        project = random.choice(["PROJ", "BACK", "FRNT", "OPS", "PLAT", "SEC"])
        ticket_id = f"{project}-{random.randint(1000, 9999)}"
        priority = _pick(["P0 — Critical", "P1 — High", "P2 — Medium", "P3 — Low (maybe never)", "P4 — Wishful Thinking"])
        issue_type = _pick(["Bug", "Task", "Story", "Spike", "Epic", "Sub-task della sub-task"])

        ac = random.sample(ACCEPTANCE_CRITERIA, min(3, len(ACCEPTANCE_CRITERIA)))
        definition_of_done = [
            "✅ Code review approvata (da qualcuno che non ha scritto il codice)",
            "✅ Test passano (almeno in locale, la CI e' un optional)",
            "✅ Documentazione aggiornata (README.md, basta quello)",
            "✅ Deployato in staging (e speriamo bene)",
            f"✅ Approvazione del product owner (sempre che non cambi idea entro {random.randint(1, 5)} giorni)",
            "✅ Il ticket e' stato spostato in 'Done' (questo e' il vero DoD)",
        ]

        return {
            "ticket": ticket_id,
            "url": f"https://jira.your-company.com/browse/{ticket_id}",
            "summary": summary,
            "type": issue_type,
            "priority": priority,
            "epic": epic or f"{_pick(BUZZWORDS).upper()}-{random.randint(1, 5)}",
            "sprint": f"Sprint {random.randint(1, 50)}",
            "assignee": "Unassigned (da 3 sprint)",
            "reporter": _pick(["Product Owner", "CTO", "CEO che ha visto un bug in demo", "Nessuno si ricorda"]),
            "story_points": random.choice([3, 5, 8, 13, 21]),
            "description": (
                f"## Overview\n"
                f"Come utente, voglio {summary.lower()} per poter {_pick(TASK_VERBS)}{_pick(TASK_NOUNS)}.\n\n"
                f"## Business Value\n"
                f"Aumentare la {_buzz(2) if self.buzzwords else 'produttivita\''} del {random.randint(15, 60)}% "
                f"(stima basata su {_pick(['dati di mercato', 'fiducia', 'un sogno', 'richiesta investitori'])}).\n\n"
                f"## Technical Notes\n"
                f"⚠️ Tocca il {_pick(TASK_NOUNS)}. Procedere con cautela.\n"
                f"Servira' un {_pick(['RFC', 'ADR', 'meeting di 2 ore', 'rewrite in Rust'])} prima di iniziare."
            ),
            "acceptance_criteria": [
                f"{g} | {w} | {t}" for g, w, t in ac
            ],
            "definition_of_done": definition_of_done,
            "estimated_real_hours": random.randint(8, 80),
            "probability_of_scope_creep": f"{random.randint(60, 95)}%",
        }

    @action("sprint_report", streaming=True)
    def sprint_report(self, payload: dict) -> Generator[dict, None, None]:
        """Genera un report di sprint con metriche inventate."""
        sprint_name = payload.get("sprint", f"Sprint {random.randint(1, 50)}")
        points_planned = random.randint(20, 60)
        points_completed = random.randint(0, points_planned)

        yield {"phase": "header", "message": f"📊 {sprint_name} Report", "progress": 5}
        time.sleep(0.2)

        # Velocity
        yield {
            "phase": "velocity",
            "velocity": {
                "planned": points_planned,
                "completed": points_completed,
                "carryover": points_planned - points_completed,
                "trend": _pick(["📈 in crescita!", "📉 in calo (colpa delle feste)", "➡️ stabile (stagnante)"]),
            },
            "progress": 25,
        }
        time.sleep(0.25)

        # Metrics
        yield {
            "phase": "metrics",
            "metrics": {
                "bug_count": random.randint(3, 30),
                "bugs_introduced_vs_fixed": f"{random.randint(5, 15)} / {random.randint(2, 10)}",
                "pr_open_time_avg": f"{random.randint(1, 14)} giorni",
                "meetings_attended": random.randint(15, 40),
                "coffee_consumed_liters": round(random.uniform(5, 30), 1),
                "lines_of_code": f"+{random.randint(200, 3000)} / -{random.randint(50, 500)}",
                "deploy_count": random.randint(1, 12),
                "hotfix_count": random.randint(0, 5),
                "times_someone_said_synergy": random.randint(5, 50) if self.buzzwords else 0,
            },
            "progress": 55,
        }
        time.sleep(0.25)

        # Standup round
        standups = self.session_standups[-min(len(self.session_standups), 5):]
        if not standups:
            standups = [self.standup({"yesterday": "niente di rilevante"}) for _ in range(min(self.team_size, 5))]

        yield {
            "phase": "standups",
            "standup_rounds": len(standups),
            "highlights": standups,
            "progress": 80,
        }
        time.sleep(0.2)

        yield {
            "phase": "done",
            "sprint": sprint_name,
            "retrospective_scheduled": f"Venerdi' alle {random.randint(16, 18)}:{random.choice(['00', '30'])}",
            "scrum_master_note": _pick(ADVICE),
            "cto_comment": "Dobbiamo aumentare la velocity. Non so come, ma dobbiamo." if self.seniority != "cto" else "Il prossimo sprint andrà meglio. Fiducia.",
            "morale": _pick(["😤", "😐", "☕", "💀", "🤡"]),
            "progress": 100,
            "final": True,
        }


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    Worker.serve()
