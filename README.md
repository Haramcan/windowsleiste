# Insel-Leiste

Eine schwebende Insel als Ersatz für die Windows-Taskleiste: klein, solange du sie nicht brauchst, und sie geht auf, sobald du mit der Maus darüberfährst.

## Was sie kann

- **Programme und Spiele anheften** und starten, auch Steam-Verknüpfungen
- **Offene Fenster** anzeigen, nach vorn holen und minimieren
- **Symbole aus dem Infobereich** (Discord, Steam, Virenscanner …) mit Links- und Rechtsklick
- **Musik** aus Spotify, Browser und anderen Playern: Titel, Cover, vor, zurück, Pause
- **Lautstärke** mit Anzeige bei Tastendruck
- **Mitteilungen** anderer Programme, pro Programm abschaltbar
- **Milchglas:** Der Hintergrund verschwimmt live hinter der Insel
- **Alte Taskleiste ausgeblendet**, beim Beenden kommt sie zurück
- **Aussehen:** heller/dunkler Modus, Desktop-Symbole, Hintergrundbild, Fensterrahmen im Insel-Stil
- **Widgets** auf dem Desktop: Uhr, Kalender, System
- **Frei verschieben** – die Position bleibt gespeichert
- Versteckt sich automatisch bei Spielen und Videos im Vollbild
- Timer

## Installieren

1. Rechts auf der GitHub-Seite unter **Releases** die „Insel-Leiste Vorschau“ öffnen.
2. `Insel-Leiste-Setup.exe` herunterladen.
3. `Insel-Leiste-Setup.exe` starten. Windows warnt beim ersten Mal, weil die Datei nicht signiert ist: **Weitere Informationen → Trotzdem ausführen**.

## Bedienung

- **Maus drüber:** Insel geht auf. **Maus weg:** Insel klappt zu.
- **Ziehen** mit gedrückter Maustaste verschiebt die Insel.
- **Plus:** Programm, Verknüpfung oder Spiel anheften.
- **Rechtsklick** auf ein Symbol: anheften oder wieder lösen.
- **Regler:** Lautstärke, Taskleiste, Autostart, Aussehen, Widgets, Mitteilungen, Insel beenden.

Falls die alte Taskleiste nach einem Absturz verschwunden bleibt: `Strg+Umschalt+Esc` → „Windows-Explorer“ → **Neu starten**.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `app/` | Die Insel selbst (Electron): Fenster, Oberfläche, Einstellungen |
| `helper/` | Kleiner Windows-Helfer (C#): Musik, Lautstärke, Fenster, Infobereich, Mitteilungen, Taskleiste. Nutzt die Bibliothek ManagedShell (Apache-2.0). |
| `prototype/` | Der klickbare Entwurf als einzelne HTML-Datei |

Entwickeln: Helfer mit `dotnet publish helper/InselHelper.csproj -c Release -o app/helper-bin` bauen, dann in `app/` `npm install` und `npm start`.
