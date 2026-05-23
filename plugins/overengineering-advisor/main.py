"""
OverEngineering Advisor — adOmnia Python Plugin

Prendi un task semplice, ricevi un'architettura enterprise ridicolmente complessa.
Dimostra l'uso completo del Python SDK: @action, streaming, storage, logging, api.
"""

import time
import json
import random
from typing import Generator

from adomnia import BaseWorker, action, log, api

# ─── Data ────────────────────────────────────────────────────────────────────

KAFKA_PREFIXES = [
    "events", "commands", "dead-letter", "retry", "audit",
    "notification", "cache-invalidation", "analytics", "reconciliation",
    "schema-registry",
]

ENTERPRISE_COMPONENTS = [
    ("API Gateway (con rate limiting a 1 req/s)", "#ff6b35"),
    ("Kafka Cluster (perché EVERYTHING is an event)", "#e63946"),
    ("Redis Cache (anche per dati che cambiano ogni 2 minuti)", "#c1121f"),
    ("Service Mesh (Istio + 47 sidecar)", "#ff6b35"),
    ("Auth Service (OAuth2 + SAML + Kerberos + face ID)", "#ff9f1c"),
    ("Core Service — Rust (zero-cost abstractions)", "#e63946"),
    ("Database Primary (PostgreSQL with 14 repliche)", "#ff6b35"),
    ("Elasticsearch (per cercare l'unica riga salvata)", "#ff9f1c"),
    ("Prometheus + Grafana (più dashboard che utenti)", "#c1121f"),
    ("CDN Layer (per servire 3 KB statici)", "#ff6b35"),
    ("Message Queue (RabbitMQ, perché Kafka non bastava)", "#ff9f1c"),
    ("Blockchain Layer (perché no)", "#e63946"),
]

RUST_REASONS = [
    "zero-cost abstractions",
    "ownership model elimina i memory leak",
    "performance 10x vs Go (fonte: fiducia)",
    "i colleghi di Netflix lo usano",
    "Linus Torvalds lo ha approvato",
    "si scrive in Rust nei job posting 2026",
    "borrow checker è il mio migliore amico",
    "unsafe è safe se sei coraggioso",
]

RUST_BENEFITS = [
    ("Performance", "+847%"),
    ("Memory Usage", "-92%"),
    ("Developer Happiness", "-100%"),
    ("Compile Time", "+∞"),
    ("Team Morale", "undefined"),
    ("LinkedIn Recruiters", "+500%"),
    ("Code Lines", "+320% (ma sono linee BELLE)"),
    ("Bug Count", "+45% (ma sono bug memory-safe)"),
]

TIMELINE_TASKS = [
    ("Setup Kafka Cluster", "1 giorno", "3 settimane"),
    ("Configurare Service Mesh", "mezza giornata", "2 mesi"),
    ("Rewrite in Rust", "3 giorni", "4 mesi"),
    ("Pipeline CI/CD", "1 ora", "1 mese"),
    ("Documentazione", "mai", "mai"),
    ("Scrivere test", "dopo il deploy", "dopo il rewrite in Rust"),
    ("Security audit", "1 sprint", "mai iniziato"),
]


def _pick(items):
    return items[hash(time.time()) % len(items)]


# ─── Worker ──────────────────────────────────────────────────────────────────

class Worker(BaseWorker):
    """OverEngineering Advisor worker."""

    def on_init(self, config: dict):
        self.enterprise_mode = config.get("settings", {}).get("enterprise_mode", True)
        self.kafka_replication = int(config.get("settings", {}).get("kafka_replication", 3))
        self.complexity = config.get("settings", {}).get("complexity_level", "maximum")
        log.info("OverEngineering Advisor initialized",
                 enterprise=self.enterprise_mode,
                 replication=self.kafka_replication,
                 complexity=self.complexity,
                 components=len(ENTERPRISE_COMPONENTS))
        # Load favorites from storage
        try:
            favs = api.storage.get("favorite_analyses")
            self.favorites = json.loads(favs) if favs else []
        except Exception:
            self.favorites = []

    def on_shutdown(self):
        log.info("OverEngineering Advisor shutting down. Remember: it's not over-engineered, it's FUTURE-PROOF.")

    # ── Actions ──────────────────────────────────────────────────────────

    @action("analyze")
    def analyze(self, payload: dict) -> dict:
        """Analizza un task e restituisce un'architettura completa."""
        task = payload.get("task", "salvare una stringa nel database")
        log.info(f"Analizzando task: {task}")

        n_components = {"moderate": 6, "high": 9, "extreme": 12, "maximum": 12}[self.complexity]
        selected = random.sample(ENTERPRISE_COMPONENTS, min(n_components, len(ENTERPRISE_COMPONENTS)))

        kafka_topics = [
            f"{_pick(KAFKA_PREFIXES)}.{w.replace(' ', '-').lower()}.v{random.randint(1,3)}"
            for w in task.split()[:self.kafka_replication + 2]
        ]

        result = {
            "task": task,
            "overcomplicated": True,
            "enterprise_mode": self.enterprise_mode,
            "architecture": [
                {"name": name, "color": color}
                for name, color in selected
            ],
            "kafka_topics": [
                {"name": t, "partitions": random.randint(3, 12), "replication": self.kafka_replication}
                for t in kafka_topics
            ],
            "rust_reason": _pick(RUST_REASONS),
            "total_components": len(selected),
            "estimated_sprint": random.randint(6, 24),
            "estimated_real": f"{random.randint(4, 12)} mesi",
            "complexity_score": "∞",
            "advice": "Abbiamo bisogno di allinearci con il team di architettura."
        }

        # Save to storage
        self.favorites.append({"task": task, "ts": time.time()})
        if len(self.favorites) > 10:
            self.favorites = self.favorites[-10:]
        api.storage.set("favorite_analyses", json.dumps(self.favorites))

        # Emit event
        api.emit("overengineering.analysis.complete", {
            "task": task,
            "components": len(selected),
            "complexity": self.complexity,
        })

        return result

    @action("analyze_stream", streaming=True)
    def analyze_stream(self, payload: dict) -> Generator[dict, None, None]:
        """Versione streaming: ogni step viene emesso come chunk."""
        task = payload.get("task", "salvare una stringa")
        complexity_multiplier = {"moderate": 1, "high": 2, "extreme": 3, "maximum": 5}[self.complexity]

        steps = [
            f"Analizzando il task: '{task}'...",
            "Identificando colli di bottiglia (ce ne sono 47)...",
            f"Aggiungendo Kafka (con {self.kafka_replication}x replication)...",
            f"Cachando TUTTO su Redis (TTL: {300 * complexity_multiplier}s)...",
            "Disegnando diagramma architetturale (in ASCII art)...",
            f"Valutando rewrite in Rust: {_pick(RUST_REASONS)}...",
            f"Stimando effort: {complexity_multiplier * 2} sprint (reali: {complexity_multiplier * 3} mesi)...",
            "Preparando slide per lo stakeholder meeting...",
            "Allineandoci con il team di architettura...",
            "Generando report finale...",
        ]

        for i, step in enumerate(steps):
            time.sleep(0.15 * complexity_multiplier * 0.3)
            yield {
                "chunk": i + 1,
                "total": len(steps),
                "message": step,
                "progress": round(((i + 1) / len(steps)) * 100),
            }

        yield {
            "chunk": len(steps) + 1,
            "total": len(steps),
            "message": "✅ Analisi completata. Conclusione: serve un rewrite in Rust.",
            "progress": 100,
            "final": True,
        }

    @action("generate_kafka_topics")
    def generate_kafka_topics(self, payload: dict) -> dict:
        """Genera topic Kafka obbligatori per un task."""
        task = payload.get("task", "generic-task")
        words = task.replace("'", "").replace('"', "").split()
        if len(words) > 5:
            words = words[:5]

        topics = []
        for prefix in random.sample(KAFKA_PREFIXES, min(6, len(KAFKA_PREFIXES))):
            for word in words[:3]:
                topics.append({
                    "name": f"{prefix}.{word.lower()}.v{random.randint(1, 3)}",
                    "partitions": random.randint(3, 12),
                    "replication": self.kafka_replication,
                    "retention_ms": random.choice([604800000, 2592000000, 86400000]),
                })

        return {
            "task": task,
            "total_topics": len(topics),
            "total_partitions": sum(t["partitions"] for t in topics),
            "topics": topics,
            "note": f"Il topic dead-letter.{words[0].lower() if words else 'task'}.failed è per quando Kafka fallisce a gestire Kafka.",
        }

    @action("rust_proposal")
    def rust_proposal(self, payload: dict) -> dict:
        """Genera una proposta di rewrite in Rust con metriche gonfiate."""
        task = payload.get("task", "un task generico")
        random.shuffle(RUST_BENEFITS)

        return {
            "task": task,
            "mandatory": True,
            "reason": _pick(RUST_REASONS),
            "benefits": [{"metric": m, "improvement": v} for m, v in RUST_BENEFITS],
            "estimated_sprint": random.randint(2, 4),
            "estimated_real": f"{random.randint(3, 8)} mesi + {random.randint(2, 5)} sprint di bug fix",
            "timeline": [
                {"task": t, "stima": s, "reale": r}
                for t, s, r in random.sample(TIMELINE_TASKS, min(5, len(TIMELINE_TASKS)))
            ],
            "disclaimer": "Nessuna di queste metriche è stata verificata. Fonte: fiducia.",
            "final_advice": "Dobbiamo allinearci con il team di architettura prima di procedere."
        }

    @action("get_favorites")
    def get_favorites(self, payload: dict = None) -> dict:
        """Restituisce le analisi salvate."""
        return {"favorites": self.favorites, "total": len(self.favorites)}


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    Worker.serve()
