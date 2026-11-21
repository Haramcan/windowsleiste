# Insel-Leiste

Eine schwebende Insel als Ersatz für die Windows-Taskleiste: klein, solange du sie nicht brauchst, und sie geht auf, sobald du mit der Maus darüberfährst.

## Was sie kann

- **Programme und Spiele anheften** und starten, auch Steam-Verknüpfungen
- **Offene Fenster** anzeigen, nach vorn holen und minimieren
- **Symbole aus dem Infobereich** (Discord, Steam, Virenscanner …) mit Links- und Rechtsklick
- **Musik** aus Spotify, Browser und anderen Playern: Titel, Cover, vor, zurück, Pause
- **Lautstärke** mit Anzeige bei Tastendruck
- **Mitteilungen** anderer Programme, pro Programm abschaltbar
- **Milchglas:** Dein Hintergrundbild verschwimmt hinter der Insel. Wahlweise Live-Milchglas, das auch Fenster dahinter zeigt, dann aber in Screenshots und Übertragungen unsichtbar ist
- **Alte Taskleiste ausgeblendet**, beim Beenden kommt sie zurück
- **Aussehen:** heller/dunkler Modus, Desktop-Symbole, Hintergrundbild, Fensterrahmen im Insel-Stil
- **Widgets** auf dem Desktop mit Milchglas: Uhr, Kalender, System, Musik, Notiz
- **Kalender** beim Klick aufs Datum, **Fenster-Vorschau** beim Überfahren eines Programms
- **Größe** der Insel einstellbar; Mikrofon stumm per `Strg+Umschalt+F11`
- **Eigenes Startmenü** in der Insel: Suche nach Programmen, Windows-Einstellungen und Dateien, dazu Sperren, Neu starten, Herunterfahren
- **Automatisch ausblenden:** Die Insel verschwindet und kommt zurück, wenn die Maus an ihren Rand fährt
- **Frei verschieben** oder Position sperren; wahlweise komplett durchsichtig
- Versteckt sich bei Spielen und Videos im Vollbild; kurz mit der Maus an den Bildschirmrand, und sie kommt zurück
- **Lautstärke pro Programm**, Mikrofon stummschalten mit Anzeige in der Insel
- **Windows-Taste** öffnet das Menü der Insel (abschaltbar)
- **Bildschirmausschnitt** aufnehmen und **Notizen**
- Angeheftete Programme per Ziehen **umsortieren**

- **Automatische Updates:** Die Insel lädt neue Versionen selbst; installiert wird per Klick unter „Regler“ oder beim nächsten Beenden

## Installieren

1. Rechts auf der GitHub-Seite unter **Releases** die „Insel-Leiste Vorschau“ öffnen.
2. `Insel-Leiste-Setup.exe` herunterladen.
3. `Insel-Leiste-Setup.exe` starten. Windows warnt beim ersten Mal, weil die Datei nicht signiert ist: **Weitere Informationen → Trotzdem ausführen**.

## Bedienung

- **Maus drüber:** Insel geht auf. **Maus weg:** Insel klappt zu.
- **Ziehen** mit gedrückter Maustaste verschiebt die Insel.
- **Plus:** Programm, Verknüpfung oder Spiel anheften.
- **Rechtsklick auf ein Programm:** neues Fenster, als Administrator, Speicherort, anheften/lösen, Fenster schließen, **Task beenden**, Task-Manager.
- **Rechtsklick auf den Start-Knopf:** wie Win+X (Geräte-Manager, Terminal, Ausführen, Herunterfahren …).
- **Rechtsklick auf die Insel:** Task-Manager, Desktop anzeigen, Schnelleinstellungen, Mitteilungszentrale.
- **Umschalt+Klick** oder **mittlere Maustaste:** neues Fenster. Mehrere Fenster: jeder Klick schaltet weiter.
- **Fenster-Vorschau:** Maus auf einem Programm zeigt alle seine Fenster; Klick wechselt, Kreuz schließt.
- **Dateien auf ein Programm ziehen** öffnet sie damit.
- **Am Symbol:** Fortschritt (z. B. Downloads), Zähler und orange Markierung, wenn ein Programm Aufmerksamkeit will.
- **Zuletzt geöffnete Dateien** im Rechtsklick-Menü eines Programms.
- **Regler:** Lautstärke, Ton und Mikrofon stumm, Lautstärke pro Programm.
- **Einstellungen:** Position, Durchsichtig, Taskleiste, Autostart, Windows-Taste, Aussehen, Widgets, Mitteilungen, Update, Insel beenden.

**Notausgang:** `Strg+Umschalt+F12` beendet die Insel jederzeit und holt die alte Taskleiste zurück.

Falls die alte Taskleiste nach einem Absturz verschwunden bleibt: `Strg+Umschalt+Esc` → „Windows-Explorer“ → **Neu starten**.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `app/` | Die Insel selbst (Electron): Fenster, Oberfläche, Einstellungen |
| `helper/` | Kleiner Windows-Helfer (C#): Musik, Lautstärke, Fenster, Infobereich, Mitteilungen, Taskleiste. Nutzt die Bibliothek ManagedShell (Apache-2.0). |
| `prototype/` | Der klickbare Entwurf als einzelne HTML-Datei |

Entwickeln: Helfer mit `dotnet publish helper/InselHelper.csproj -c Release -o app/helper-bin` bauen, dann in `app/` `npm install` und `npm start`.
