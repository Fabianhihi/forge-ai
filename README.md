# Vela Linux – Secure Tor Edition (Raspberry Pi 3)

Ein schlankes, sicherheitsorientiertes Desktop-Betriebssystem für den Raspberry Pi 3.
Es startet ohne Passwort auf den Vela-Desktop. Es gibt Fenster, eine Leiste oben,
ein Startmenü und die Programme **Tor Browser** (Standardbrowser), Dateien,
Terminal, Texteditor, Rechner, Bildbetrachter und einen Sicherheitsstatus.
Eine Firewall sorgt dafür, dass **nur Tor** ins Internet darf.

**Tastenkürzel:** `Super+Leertaste` öffnet die Programme, `Super+B` den Tor Browser,
`Super+Enter` das Terminal und `Super+E` die Dateien. Ein Rechtsklick auf den Desktop öffnet das Menü.

| | |
|---|---|
| Basis | Debian 13 „trixie“ arm64, minimal |
| Browser | Tor Browser (offizielle ARM64-Version, Signatur wird beim Bau geprüft) |
| Download-Größe | Ziel: **unter 430 MB** (`.img.xz`, der Bau bricht ab, wenn es größer wird) |
| Hardware | Raspberry Pi 3 B / 3 B+ (auch Pi 4), SD-Karte ab 4 GB |

## Was Vela Secure schützt

- **Killswitch-Firewall**: Ins Internet darf nur Tor. Fällt die Firewall aus, startet auch Tor nicht.
- **Alle Updates laufen über Tor**: Das System aktualisiert sich täglich automatisch.
- **Kein SSH und kein Fernzugriff**, root ist gesperrt, **Bluetooth ist aus**.
- **Zufällige WLAN-MAC-Adresse**, und der Router bekommt keinen Gerätenamen.
- **Logs liegen nur im RAM**: Nach dem Ausschalten bleibt nichts gespeichert.
- **Gehärteter Kernel**: AppArmor, Speicher wird bei Belegung und Freigabe genullt, Kernel-Adressen sind versteckt.
- **zram**: komprimierter Arbeitsspeicher, damit der Tor Browser mit 1 GB RAM auskommt.

## Bauen – Weg A: GitHub (automatisch)

Bei jeder Änderung baut GitHub Actions Vela neu und veröffentlicht ein Release mit
`vela-installer.run` und `vela-secure-pi3.img.xz`. Manuell startest du den Bau unter **Actions → „Vela Secure bauen“ → Run workflow**.
Ein Bau dauert etwa 1–2 Stunden, weil der ARM-Prozessor emuliert wird.

## Image bauen – Weg B: auf deinem Raspberry Pi (64-bit Raspberry Pi OS)

```bash
sudo apt install debootstrap debian-archive-keyring parted dosfstools xz-utils curl gpg
sudo ./build.sh
```

Auf einem x86-Linux-PC brauchst du zusätzlich `qemu-user-static binfmt-support`.

## Installieren per USB-Stick (direkt am Pi)

Lade aus dem neuesten GitHub-Release die Datei **`vela-installer.run`** herunter. Es ist eine einzige Datei, die alles enthält.

1. Kopiere `vela-installer.run` auf einen USB-Stick (FAT32, mindestens 2 GB).
2. Stecke den Stick in den Pi mit Raspberry Pi OS. Es geht mit dem Pi 3 B und B+ und mit 32- und 64-Bit-Systemen. Tippe im Terminal:
   `sudo bash /media/*/*/vela-installer.run`
3. Tippe `VELA` ein und starte neu. Der Installer schreibt Vela auf die SD-Karte, prüft es und startet Vela.
   In den ersten 15 Sekunden kannst du mit einer Taste abbrechen.

## Auf die SD-Karte flashen (am PC)

1. Öffne den **Raspberry Pi Imager** und wähle **Raspberry Pi 3**.
2. Wähle bei Betriebssystem **„Eigenes Image verwenden“** und dann `vela-secure-pi3.img.xz`.
3. Für WLAN: Öffne nach dem Flashen auf der SD-Karte (Laufwerk `RASPIFIRM`) die Datei
   `vela-wlan.txt` und trage `SSID=` und `PASSWORT=` ein.
   Das Passwort wird beim ersten Start übernommen und danach aus der Datei gelöscht.
4. Stecke die SD-Karte in den Pi und schalte ihn ein. Nach etwa 1–2 Minuten ist der Tor Browser da.

> Die Firmware-Benutzereinstellungen des Imagers (Benutzer, WLAN, SSH) werden
> von Vela ignoriert. Bitte stattdessen `vela-wlan.txt` benutzen.

## Hinweise

- Der Raspberry Pi 3 hat nur 1 GB RAM. Der Tor Browser läuft, ist aber spürbar langsamer als am PC.
- Beim ersten Start muss die Uhrzeit über das Internet gestellt werden, sonst verbindet Tor nicht.
  Der Pi hat keine eingebaute Uhr. Deshalb ist der Uhrzeit-Abgleich die einzige Ausnahme in der Firewall.
- In Ländern mit Zensur: Im Tor Browser unter *Einstellungen → Verbindung* eine Brücke einstellen.
