# Insel-Leiste

Eine schwebende Insel als Ersatz für die Windows-Taskleiste: klein, solange du sie nicht brauchst, und sie geht auf, sobald du mit der Maus darüberfährst.

## Was sie kann (Version 0.1)

- **Programme und Spiele anheften** und starten, auch Steam-Verknüpfungen
- **Offene Fenster** anzeigen, nach vorn holen und minimieren
- **Musik** aus Spotify, Browser und anderen Playern: Titel, Cover, vor, zurück, Pause
- **Lautstärke** und Stummschalten
- **Frei verschieben** – die Position bleibt gespeichert
- **Alte Taskleiste ausblenden** (Schalter unter „Regler“), beim Beenden kommt sie zurück
- Versteckt sich automatisch bei Spielen und Videos im Vollbild
- Timer

## Installieren

1. Auf GitHub oben auf **Actions** klicken und den neuesten Lauf mit grünem Haken öffnen.
2. Unten bei **Artifacts** `Insel-Leiste-Setup` herunterladen und die ZIP-Datei entpacken.
3. `Insel-Leiste-Setup.exe` starten. Windows warnt beim ersten Mal, weil die Datei nicht signiert ist: **Weitere Informationen → Trotzdem ausführen**.

## Bedienung

- **Maus drüber:** Insel geht auf. **Maus weg:** Insel klappt zu.
- **Ziehen** mit gedrückter Maustaste verschiebt die Insel.
- **Plus:** Programm, Verknüpfung oder Spiel anheften.
- **Rechtsklick** auf ein Symbol: anheften oder wieder lösen.
- **Regler:** Lautstärke, Taskleiste ausblenden, mit Windows starten, Insel beenden.

Falls die alte Taskleiste nach einem Absturz verschwunden bleibt: `Strg+Umschalt+Esc` → „Windows-Explorer“ → **Neu starten**.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `app/` | Die Insel selbst (Electron): Fenster, Oberfläche, Einstellungen |
| `helper/` | Kleiner Windows-Helfer (C#): Musik, Lautstärke, Fensterliste, Taskleiste |
| `prototype/` | Der klickbare Entwurf als einzelne HTML-Datei |

Entwickeln: Helfer mit `dotnet publish helper/InselHelper.csproj -c Release -o app/helper-bin` bauen, dann in `app/` `npm install` und `npm start`.
