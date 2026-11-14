# FORGE AI – Quellcode

Deine eigene lokale KI-App für **Code** und **3D-Modelle**. Der KI-Motor (llama.cpp über `node-llama-cpp`) ist direkt eingebaut: kein Ollama, keine Cloud, kein API-Key.

## Was beim ersten Start automatisch passiert

1. Grafikkarte und Arbeitsspeicher werden erkannt (Vulkan, sonst Prozessor).
2. Das passende Modell wird ausgewählt und von Hugging Face geladen. Abgebrochene Downloads laufen beim nächsten Start weiter.
3. Die KI startet. Ab dann läuft alles offline.

| Hardware | Modell |
|---|---|
| Grafikkarte ab 11 GB | Qwen2.5-Coder 14B (9 GB) |
| Grafikkarte ab 5,5 GB oder 16 GB RAM | Qwen2.5-Coder 7B (4,7 GB) |
| sonst | Qwen2.5-Coder 3B (1,9 GB) |

In der App unter „KI-Modelle“ kannst du jederzeit wechseln (auch Qwen3-Coder 30B oder eine eigene GGUF-Datei).

## Selbst starten / weiterentwickeln

Voraussetzung: [Node.js](https://nodejs.org) (LTS).

```bat
npm install
npm start
```

Oder `Starten.bat` doppelklicken.

## Aufbau

| Datei | Was sie macht |
|---|---|
| `main.js` | Hauptprozess: Fenster, IPC, Speichern-Dialoge, HTML-Vorschau |
| `engine.js` | KI-Motor: Hardware-Erkennung, Modell-Download (mit Fortsetzen), Laden, Chat-Streaming, JSON-Grammatik für 3D |
| `preload.js` | Sichere Brücke zwischen Oberfläche und Hauptprozess |
| `src/app.js` | Oberfläche: Chat, automatische Einrichtung, Modelle, Einstellungen, 3D-Steuerung |
| `src/viewer3d.js` | 3D-Ansicht (Three.js), baut Modelle aus dem KI-JSON, Export GLB/OBJ/STL |
| `src/prompts.js` | Persönlichkeit der KI, 3D-Regeln und JSON-Schema |
| `installer/forge-ai.nsi` | Windows-Installer (NSIS) |

Daten liegen unter `%APPDATA%\FORGE AI` (Modelle im Unterordner `models`).
