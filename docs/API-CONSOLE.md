# API-Console

Die **API-Console** ist ein in DeskOS eingebauter REST-Client – ein Mini-„Postman"
direkt im Dashboard. Damit kannst du das DeskOS-Backend erkunden und testen,
ohne die App zu verlassen oder ein externes Tool zu öffnen.

Quelle: [`apps/frontend/src/components/ApiConsoleView.tsx`](../apps/frontend/src/components/ApiConsoleView.tsx)

---

## Wofür ist das gut?

Das Backend stellt eine REST-API unter `/api/*` bereit (Geräte, System-Metriken,
Events, Logs, Benachrichtigungen, WLED/RGB, Layouts, Sensoren, Plugins,
Automationen … – siehe [API.md](./API.md)). Die API-Console ist der schnellste
Weg, diese Endpunkte auszuprobieren:

- **Debuggen** – schnell prüfen, was ein Endpunkt gerade zurückgibt.
- **Erkunden** – ohne Doku sehen, welche Felder eine Antwort enthält.
- **Steuern** – schreibende Aktionen (Gerät umbenennen, WLED schalten …) direkt
  auslösen und die Antwort kontrollieren.

Base-URL und Auth-Token stammen aus **derselben Quelle wie der Rest der App**
(`lib/api`). Ist ein `DESKOS_TOKEN` gesetzt, wird der `Authorization`-Header
automatisch mitgeschickt – die Console zeigt das oben rechts als `AUTH · TOKEN`
an (sonst `AUTH · AUS`).

---

## Öffnen

Über das [Overlay-Menü](./MENU.md) (Strg/⌘ + K) → Seite **SYSTEM** →
Kachel **API Console**.

> Zuvor führte diese Kachel nur zurück aufs Dashboard, weil ihr keine eigene
> Ansicht (`view`) zugeordnet war. Jetzt öffnet sie die echte Console.

---

## Bedienung

1. **Methode** wählen: `GET`, `POST`, `PATCH` oder `DELETE`.
2. **Pfad** eingeben, z. B. `/api/devices` oder `/health`. Unter dem Feld siehst
   du die vollständige Ziel-URL zur Kontrolle.
3. Bei `POST`/`PATCH` optional einen **JSON-Body** eintragen. Ungültiges JSON
   wird vor dem Senden abgefangen und im Response-Bereich gemeldet.
4. **Senden** klicken (oder **Strg/⌘ + Enter**).

Im **Response**-Bereich erscheinen:

- **Status** (farbcodiert: 2xx grün, 3xx cyan, 4xx gelb, 5xx/Netzwerkfehler rot)
  und die **Dauer** in Millisekunden,
- der **Body**, bei JSON automatisch eingerückt,
- aufklappbar die **Response-Header**.

### Endpunkt-Katalog

Rechts liegt ein kuratierter Katalog der wichtigsten Endpunkte, nach Bereichen
gruppiert. Ein Klick füllt Methode, Pfad und (falls sinnvoll) einen Beispiel-Body
vor. Platzhalter wie `:id` ersetzt du durch eine echte ID.

### Verlauf

Gesendete Anfragen landen im **Verlauf** (lokal gespeichert, letzte 12). Ein Klick
stellt Methode, Pfad und Body wieder her – praktisch zum wiederholten Testen.

---

## Hinweis zu schreibenden Anfragen

`POST`, `PATCH` und `DELETE` verändern **echten Backend-Zustand** (z. B. Geräte
entfernen, WLED schalten). Bei diesen Methoden weist die Console unter dem
Body-Feld ausdrücklich darauf hin. Zum reinen Erkunden bleibst du am besten bei
`GET`.
