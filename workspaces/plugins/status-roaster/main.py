"""HTTP Status Code Roaster — because your API failures deserve mockery."""

import json
import random
from typing import Generator

from adomnia import api, log
from adomnia.worker import BaseWorker, action

_ROASTS: dict[int, list[str]] = {
    # 1xx — Informational
    100: [
        "100 Continue... e io continuo ad aspettare qualcosa di sensato. Spoiler: non arrivera'.",
        "Ah, 100. Il server ti sta dicendo 'va bene, ho sentito, ma non ho ancora fatto niente'. Come il tuo capo.",
        "Continue? Il server ti sta ghostando educatamente.",
    ],
    101: [
        "101 Switching Protocols. Il server cambia protocollo. Magari cambiasse anche idea su questa API scritta col culo.",
        "Switching Protocols: l'equivalente tecnologico di 'cambio discorso perche' mi hai sgamato'.",
    ],
    102: [
        "102 Processing. Traduzione: 'sto facendo finta di lavorare, torna dopo'. Come quando apri Excel e fissi lo schermo.",
        "Processing... la risposta che dai quando non sai rispondere. Il server e' un politico.",
    ],
    103: [
        "103 Early Hints. Ti do' un anticipo, cosi' puoi iniziare a preoccuparti prima.",
    ],

    # 2xx — Success (but we roast anyway)
    200: [
        "200 OK. Wow, ha funzionato. Vuoi un biscotto? Forse anche un applauso?",
        "OK 200. La richiesta ha funzionato. Ti senti realizzato ora? Sono €0 di commissione.",
        "200 OK — il minimo sindacale. Se festeggi un 200, alza l'asticella.",
    ],
    201: [
        "201 Created. Hai creato qualcosa. Tipo... un problema in piu' nel database.",
        "Created 201. Congratulazioni, ora esiste un'altra riga di cui pentirsi domani.",
    ],
    202: [
        "202 Accepted. Il server ha accettato, ma non ha ancora fatto niente. Tipo iscriversi in palestra a gennaio.",
        "Accepted: 'si', ma detto senza entusiasmo. Come quando inviti qualcuno a cena e dice 'forse'.",
    ],
    203: [
        "203 Non-Authoritative. Traduzione: 'ho chiesto in giro, non garantisco'. Come le notizie su WhatsApp.",
    ],
    204: [
        "204 No Content. Il server ti risponde col vuoto cosmico. Come la tua vita sentimentale.",
        "No Content — il server ha deciso che non meriti nemmeno una risposta. Rispetto.",
    ],
    205: [
        "205 Reset Content. Resetta la pagina e prova a non rompere stavolta.",
    ],
    206: [
        "206 Partial Content. Solo un pezzo? Come la pizza che lascia l'amico a dieta. Che tristezza.",
    ],
    207: [
        "207 Multi-Status. Risultati multipli, tutti probabilmente deludenti. Come gli appuntamenti su Tinder.",
    ],
    208: [
        "208 Already Reported. Si', lo sappiamo, l'hai gia' detto. Noioso.",
    ],
    226: [
        "226 IM Used. Instant Messaging? Siamo nel 2005? Chiamami quando il server usa WhatsApp.",
    ],

    # 3xx — Redirection
    300: [
        "300 Multiple Choices. Scegline una, indeciso! Il server e' peggio di me al ristorante.",
        "Multiple Choices: come se avessi opzioni migliori. Spoiler: nessuna funziona.",
    ],
    301: [
        "301 Moved Permanently. Ha traslocato. Non ti ha lasciato il nuovo indirizzo? Che maleducato.",
        "Moved Permanently — come il tuo ex. E come il tuo ex, non tornera'.",
    ],
    302: [
        "302 Found... temporaneamente. E' li', ma tra un po' se ne va. Come la tua voglia di programmare.",
    ],
    303: [
        "303 See Other. 'Guarda da un'altra parte'. Ti sta friendzonando, questa API.",
    ],
    304: [
        "304 Not Modified. Non e' cambiato niente. Come la tua carriera.",
        "Not Modified: il server ti sta dicendo che sei irrilevante da quando hai fatto l'ultima richiesta.",
    ],
    305: [
        "305 Use Proxy. Il server non si fida di te. Vuole un intermediario. Ti capisco, server.",
    ],
    307: [
        "307 Temporary Redirect. 'Vai la'... per ora. Il server non sa decidersi. Classico.",
    ],
    308: [
        "308 Permanent Redirect. Definitivo. Come la tua condanna a debuggare alle 3 di notte.",
    ],

    # 4xx — Client Errors (the real fun)
    400: [
        "400 Bad Request. Sei TU la bad request. Il server ti sta giudicando. Ha ragione.",
        "Bad Request: il server ha letto la tua richiesta e ha riso. Poi ha pianto. Poi ti ha mandato 400.",
        "400 — la richiesta e' cosi' brutta che il server non sa nemmeno da dove iniziare a insultarti.",
    ],
    401: [
        "401 Unauthorized. Non puoi entrare. Butta via quel token, e' scaduto. Come le tue speranze.",
        "Unauthorized — chi ti credi di essere? Il proprietario? Torna al login, plebeo.",
    ],
    402: [
        "402 Payment Required. PAGA. Il server non e' una ONLUS. Vuole i tuoi soldi. Adesso.",
        "Payment Required: il capitalismo e' arrivato anche nella tua API. Sorprendente.",
    ],
    403: [
        "403 Forbidden. Accesso negato. Il server ti odia personalmente. Forse hai offeso sua madre.",
        "Forbidden: non e' che non puoi, e' che NON DEVI. C'e' differenza. Il server e' tuo padre che ti mette in punizione.",
    ],
    404: [
        "404 Not Found. Hai cercato nell'Abisso. L'endpoint non esiste. Come la tua vita sociale un sabato sera.",
        "Not Found — come il bug che cerchi da 3 ore. Come la documentazione aggiornata. Come la tua sanita' mentale dopo questo progetto.",
        "404: complimenti, hai trovato il nulla. Il vuoto. L'oblio digitale. Ti senti un esploratore?",
    ],
    405: [
        "405 Method Not Allowed. Hai usato POST? Dovevi usare GET. O viceversa. LEGGI la dannata documentazione.",
        "Method Not Allowed: il server e' schizzinoso. Non gli piace come lo tocchi.",
    ],
    406: [
        "406 Not Acceptable. La tua richiesta e'... inaccettabile. Come le tue scelte di vita.",
    ],
    407: [
        "407 Proxy Authentication Required. Autenticati al proxy. Catena di comando. Burocrazia. Italia.",
    ],
    408: [
        "408 Request Timeout. Il server si e' stancato di aspettarti. Sei troppo lento. Come nei rapporti umani.",
        "Timeout: il server ha una vita, sai? Non puo' starti dietro tutto il giorno.",
    ],
    409: [
        "409 Conflict. C'e' un conflitto. Tra la tua richiesta e la realta'. La realta' vince.",
        "Conflict: hai provato a creare qualcosa che esiste gia'. Originalita': zero.",
    ],
    410: [
        "410 Gone. Andato. Sparito. Defunto. Come la tua motivazione il lunedi' mattina.",
        "Gone — l'endpoint e' morto. Non chiedere perche'. Fatti una ragione.",
    ],
    411: [
        "411 Length Required. Il server vuole sapere quanto e' lungo. Dai, non fare il timido.",
        "Length Required — e' la prima volta che qualcuno ti chiede le dimensioni, vero?",
    ],
    412: [
        "412 Precondition Failed. Le condizioni non erano quelle giuste. Tipo uscire senza ombrello: piove sempre.",
    ],
    413: [
        "413 Payload Too Large. Hai inviato troppa roba. Chi ti credi di essere? Netflix?",
        "Payload Too Large — il server ha smesso di leggere al terzo gigabyte. Fatti due domande.",
    ],
    414: [
        "414 URI Too Long. L'URL e' piu' lungo della lista della spesa di tua madre. Taglia!",
        "URI Too Long — questo non e' un URL, e' un romanzo. Pubblica su Amazon.",
    ],
    415: [
        "415 Unsupported Media Type. Il server non capisce cosa gli hai mandato. Come te quando parli con una ragazza.",
        "Unsupported Media Type — neanche il server vuole i tuoi meme. Triste.",
    ],
    416: [
        "416 Range Not Satisfiable. Hai chiesto troppo. Nella vita come nelle API, impara ad accontentarti.",
    ],
    417: [
        "417 Expectation Failed. Ti aspettavi troppo. La vita e' delusione. Anche le API lo sanno.",
    ],
    418: [
        "418 I'm a Teapot. SONO UNA TEIERA. Non posso fare il caffe'! Che parte di 'teiera' non capisci?!?",
        "I'm a Teapot — il server e' una teiera. Letteralmente. Chiedi al server se ha del te' verde.",
        "418: il miglior status code mai inventato. L'unica risposta onesta di Internet.",
    ],
    421: [
        "421 Misdirected Request. Hai sbagliato server. Come quando entri nel bagno sbagliato. Imbarazzante.",
    ],
    422: [
        "422 Unprocessable Entity. La richiesta e' sintatticamente corretta, ma semanticamente... una cagata.",
        "Unprocessable Entity — il server ti sta dicendo che capisce le parole ma non il senso. Come leggere Hegel.",
    ],
    423: [
        "423 Locked. Bloccato. Come il bagno dell'autogrill. Prova piu' tardi, o Impara a bussare.",
    ],
    424: [
        "424 Failed Dependency. Qualcun altro ha fallito, e tu ne paghi le conseguenze. Lavoro di gruppo in una response HTTP.",
    ],
    425: [
        "425 Too Early. Sei in anticipo. Ne' tu ne' il server siete pronti per questa conversazione.",
    ],
    426: [
        "426 Upgrade Required. Devi aggiornarti. Il server e' snob e non parla coi poveracci. Apple style.",
    ],
    428: [
        "428 Precondition Required. Metti a posto le condizioni, poi ne riparliamo. Il server e' passivo-aggressivo.",
    ],
    429: [
        "429 Too Many Requests. RALLENTA. Stai facendo troppe richieste. Il server non e' il tuo psicologo.",
        "Too Many Requests — hai rotto il rate limit. Ti odiano. Forse e' ora di uscire a prendere aria.",
        "429: complimenti, sei ufficialmente MOLESTO. Il server ti ha messo in pausa di riflessione.",
    ],
    431: [
        "431 Request Header Fields Too Large. Gli header sono ENORMI. Il server ha paura. Anche io.",
    ],
    451: [
        "451 Unavailable For Legal Reasons. Il governo ha detto no. Colpa degli avvocati, non tua. Per una volta.",
        "Unavailable For Legal Reasons — la censura e' arrivata. Non hai fatto niente di male. Probabilmente.",
    ],

    # 5xx — Server Errors
    500: [
        "500 Internal Server Error. Il server e' in fiamme. Letteralmente. Scappa. Non guardare indietro.",
        "Internal Server Error: il server ha ammesso di non capirci piu' niente. Onesto, almeno.",
        "500 — qualcuno ha pushato di venerdi' pomeriggio. E ora piange.",
    ],
    501: [
        "501 Not Implemented. Non l'hanno ancora fatto. Pigri. Il server ammette la propria inettitudine.",
        "Not Implemented: 'si', lo faremo, 'forse', 'un giorno' — il server e' un politico.",
    ],
    502: [
        "502 Bad Gateway. Il server ha chiesto a un altro server e quello ha risposto a vanvera. Passacarte.",
        "Bad Gateway — e' colpa del server di mezzo. Il classico 'non e' colpa mia'. Cresci, server.",
    ],
    503: [
        "503 Service Unavailable. Il server e' in pausa pranzo. O forse e' morto. Prova a rianimarlo.",
        "Service Unavailable: il server ha staccato. Forse e' sabato sera. Anche i server hanno diritto a una vita.",
    ],
    504: [
        "504 Gateway Timeout. Il server upstream non risponde. Sara' in smart working.",
        "Gateway Timeout — qualcuno nella catena si e' addormentato. Sveglialo a calcioni.",
    ],
    505: [
        "505 HTTP Version Not Supported. Il server e' vecchio. Come Internet Explorer. Come i tuoi gusti musicali.",
    ],
    506: [
        "506 Variant Also Negotiates. Negoziazione infinita. Il server e' un avvocato divorzista.",
    ],
    507: [
        "507 Insufficient Storage. Spazio finito. Il server e' pieno come il telefono di tua madre con le foto dei gatti.",
    ],
    508: [
        "508 Loop Detected. Loop infinito. Il server e' entrato in un circolo vizioso. Come te che ricarichi la pagina da 10 minuti.",
    ],
    510: [
        "510 Not Extended. Il server non supporta estensioni. E' un conservatore. Probabilmente vota a destra.",
    ],
    511: [
        "511 Network Authentication Required. Devi autenticarti prima ancora di parlare. Aeroporto digitale. Togli le scarpe.",
    ],
}

_FALLBACK_ROASTS = [
    "Status code {code}? Mai sentito. Probabilmente e' quello che ottieni quando l'universo ti odia.",
    "{code}... non so cosa sia, ma so gia' che e' colpa tua.",
    "HTTP {code}: un codice cosi' raro che manco il server sa cosa significhi. Chiedi a Stack Overflow.",
    "{code}??? Questo status code e' piu' misterioso del motivo per cui stai ancora debuggando a quest'ora.",
]


class StatusRoaster(BaseWorker):
    def on_init(self, config: dict) -> None:
        log.info("Status Roaster caricato. Pronto a insultare status code.", codes=str(len(_ROASTS)))

    @action("roast")
    def roast(self, payload: bytes) -> bytes:
        data = json.loads(payload) if payload else {}
        code = data.get("code", 0)
        return self._roast_code(int(code))

    @action("roast_response")
    def roast_response(self, payload: bytes) -> bytes:
        request = api.get_current_request()
        code = request.get("status_code", 0)
        if not code:
            return json.dumps({
                "status_code": None,
                "roast": "Nessuna response da arrostire. Fai una richiesta prima, genio.",
                "severity": "info",
            }).encode()
        result = self._roast_result(int(code))
        api.emit("roast_delivered", result)
        return json.dumps(result).encode()

    @action("roast_all", streaming=True)
    def roast_all(self, payload: bytes) -> Generator[bytes, None, bytes]:
        for code in sorted(_ROASTS.keys()):
            roast = random.choice(_ROASTS[code])
            item = {"code": code, "roast": roast}
            api.emit("roast_chunk", item)
            yield json.dumps(item).encode()
        yield json.dumps({"done": True, "total": len(_ROASTS)}).encode()

    def _roast_code(self, code: int) -> bytes:
        return json.dumps(self._roast_result(code)).encode()

    def _roast_result(self, code: int) -> dict:
        if code in _ROASTS:
            roast = random.choice(_ROASTS[code])
        else:
            roast = random.choice(_FALLBACK_ROASTS).format(code=code)

        if 100 <= code < 200:
            severity = "yawn"
        elif 200 <= code < 300:
            severity = "meh"
        elif 300 <= code < 400:
            severity = "ouch"
        elif 400 <= code < 500:
            severity = "burn"
        elif 500 <= code < 600:
            severity = "inferno"
        else:
            severity = "wat"

        return {"status_code": code, "roast": roast, "severity": severity}

    def on_shutdown(self) -> None:
        log.info("Status Roaster spento. Finiti gli insulti per oggi.")


if __name__ == "__main__":
    StatusRoaster.serve()
