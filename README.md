# Familie ToDo

Gemeinsame Aufgaben-App für die Familie: Eltern weisen Kindern Aufgaben zu (Schule, Haushalt, Lernen), Kinder melden mit Kommentaren und Zeiten zurück. Läuft als PWA im Browser und installierbar auf Handy/Desktop.

- Responsive (Desktop + Handy), Dark/Light/Auto
- Prioritäten, Fälligkeiten, Kategorien, Wiederholungen (täglich/werktags/wöchentlich/monatlich)
- Subtasks/Checklisten, Kommentare, Timer (geplante + tatsächliche Zeit)
- Punkte-/Belohnungssystem für Kinder
- Drag-&-Drop zum Umsortieren und Erledigen
- Monats-Kalenderansicht (Schularbeiten etc.)
- Offline-fähig; automatisches Update-Banner bei neuer Version
- Sync über ein **privates GitHub-Repo** mit persönlichem PAT

## Hosting

Dieses Repo wird auf GitHub Pages gehostet:

- Repo (public): `JuergenPod/familie-todo`
- URL: `https://juergenpod.github.io/familie-todo/`

## Datenaustausch

Alle Familienmitglieder synchronisieren über dieselbe Datei im privaten Repo:

- Repo (privat): `JuergenPod/VocabularyCheck-Saves`
- Pfad: `familie/todo.json`

Jedes Familienmitglied legt **seinen eigenen** Personal Access Token (PAT) an. Der PAT wird nur lokal im Browser (localStorage) gespeichert, nie in diesem public Repo.

### PAT anlegen (einmalig pro Gerät/Person)

1. https://github.com/settings/tokens?type=beta — "Fine-grained token" erstellen.
2. **Resource owner** = `JuergenPod`.
3. **Repository access** = Only select repositories → `VocabularyCheck-Saves`.
4. **Repository permissions** → **Contents: Read and write**.
5. Ablaufdatum nach Geschmack setzen. Token erzeugen, kopieren.

### App verbinden

Beim ersten Start erscheint ein Setup-Bildschirm mit vorbelegten Feldern:

- Owner: `JuergenPod`
- Repo: `VocabularyCheck-Saves`
- Pfad: `familie/todo.json`
- PAT: der eben erzeugte Token

Danach kannst du Profile anlegen (mind. 1 Elternteil + 1 Kind).

## Lokal entwickeln / testen

Service Worker brauchen `http://`/`https://` (nicht `file://`):

```bash
cd ToDo2
python -m http.server 8080
# oder
npx serve .
```

Dann im Browser: `http://localhost:8080/`

## Deploy (GitHub Pages)

1. Public Repo `JuergenPod/familie-todo` anlegen.
2. Inhalt dieses Ordners (`ToDo2/*`) ins Root des Repos committen und pushen.
3. Settings → Pages → Source = `Deploy from a branch`, Branch = `main`, `/ (root)`.
4. Nach ein paar Minuten: `https://juergenpod.github.io/familie-todo/`.

Im privaten Repo sicherstellen, dass der Ordner `familie/` existiert. Falls noch nicht, leere Datei `familie/.gitkeep` oder direkt `familie/todo.json` mit `{}` anlegen.

## Release / Update-Banner

Beim Veröffentlichen einer neuen Version:

1. `version.json` hochzählen, z. B. `"version": "1.0.1"`.
2. In `sw.js` `APP_VERSION` auf denselben Wert setzen (`const APP_VERSION = '1.0.1'`).
3. Commit + Push.

Jedes geöffnete Familien-Gerät holt beim Start `version.json` und zeigt den Banner "Neue Version verfügbar". Klick auf "Neu laden" aktiviert den neuen Service Worker und lädt die App frisch.

## Datenmodell (familie/todo.json)

```json
{
  "version": 1,
  "updatedAt": "2026-04-19T10:00:00Z",
  "users": [
    { "id": "u1", "name": "Mama", "role": "parent", "color": "#e74c3c", "emoji": "👩" }
  ],
  "tasks": [
    {
      "id": "t1",
      "title": "Mathe Hausaufgabe",
      "description": "Seite 42, Aufgabe 1-5",
      "category": "Schule",
      "assignedTo": "u2",
      "createdBy": "u1",
      "createdAt": "2026-04-19T08:00:00Z",
      "updatedAt": "2026-04-19T09:30:00Z",
      "dueDate": "2026-04-20",
      "estimatedMinutes": 30,
      "actualMinutes": 25,
      "priority": "medium",
      "status": "open",
      "completedAt": null,
      "recurrence": null,
      "sortOrder": 0,
      "points": null,
      "subtasks": [
        { "id": "s1", "text": "Aufgabe 1", "done": true, "updatedAt": "..." }
      ],
      "comments": [
        { "id": "c1", "by": "u2", "at": "...", "text": "Aufgabe 1 war leicht!" }
      ]
    }
  ],
  "pointsLog": [
    { "id": "p1", "userId": "u2", "taskId": "t0", "points": 10, "awardedAt": "..." }
  ]
}
```

## Sync-Strategie

**Merge-by-ID + Last-Write-Wins pro Entity.** Lokale und Remote-Änderungen werden bei jedem Push zusammengeführt:

- Gleiches `id`, unterschiedlicher Stand: Entity mit neuerem `updatedAt` gewinnt.
- Nur lokal bekannt / nur remote bekannt: Entity wird übernommen.
- `subtasks` werden per ID gemergt, nach `updatedAt`.
- `comments` und `pointsLog` sind append-only: Set-Union nach `id`.
- Task-Löschungen sind Tombstones (`deletedAt`), werden nach 30 Tagen hart entfernt.

Bei GitHub-Konflikt (`409`) wird automatisch erneut gepullt, gemergt und gepusht (bis zu 4 Versuche).

## Punkte-System

Default pro Aufgabe nach Priorität:

| Priorität | Punkte |
| --- | --- |
| Niedrig | 5 |
| Normal | 10 |
| Hoch | 20 |

Bonus **+5** Punkte, wenn `actualMinutes ≤ estimatedMinutes` (pünktlich fertig). Override pro Aufgabe im Task-Formular (Feld "Punkte"). Punkte landen im `pointsLog` beim Erledigen; werden beim Rück-öffnen (Undo) wieder entfernt.

## Ordnerstruktur

```
ToDo2/
├── index.html
├── manifest.json
├── sw.js
├── version.json
├── README.md
├── icons/
│   ├── icon.svg
│   ├── icon-192.svg
│   └── icon-512.svg
└── js/
    ├── app.js        — Einstieg, Screen-Routing, Events
    ├── config.js     — localStorage-Config (owner/repo/path/pat/user/theme)
    ├── store.js      — State, CRUD, Persistenz
    ├── github.js     — GitHub Contents API
    ├── sync.js       — Pull-Merge-Push-Pipeline
    ├── ui.js         — Rendering-Helfer
    ├── theme.js      — Dark/Light
    ├── timer.js      — Start/Stop-Timer
    ├── dnd.js        — Drag-&-Drop (SortableJS)
    ├── points.js     — Punkte-Berechnung
    └── calendar.js   — Monats-Kalenderansicht
```

Keine Build-Tools, kein npm — direkt deploybar.

## Lizenz

Privat. Nutzung innerhalb der Familie.
