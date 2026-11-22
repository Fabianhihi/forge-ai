#!/bin/bash
# =====================================================================
#  Vela Secure – USB-Installer für den Raspberry Pi 3 (B und B+)
#  Läuft unter Raspberry Pi OS (32- oder 64-Bit).
#
#  Diese EINE Datei enthält alles (Vela-Image + Installer).
#  Starten:   sudo bash /media/<name>/<STICK>/vela-installer.run
#  Rückgängig (vor dem Neustart):   sudo bash vela-installer.run --undo
# =====================================================================
set -euo pipefail
SELF="$(readlink -f "$0")"
DIR="$(dirname "$SELF")/.vela-installer"
IMG=vela-secure-pi3.img

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
lila()  { printf '\033[1;35m%s\033[0m\n' "$*"; }
die()   { echo; red "  FEHLER: $*"; echo; exit 1; }

[ "$(id -u)" = 0 ] || exec sudo bash "$SELF" "$@"

BOOT=/boot/firmware
[ -f "$BOOT/config.txt" ] || BOOT=/boot
[ -f "$BOOT/config.txt" ] || die "Boot-Partition nicht gefunden. Läuft hier Raspberry Pi OS?"

# --- Rückgängig machen ---
if [ "${1:-}" = "--undo" ]; then
  for f in config.txt cmdline.txt; do
    [ -f "$BOOT/$f.vela-backup" ] && mv "$BOOT/$f.vela-backup" "$BOOT/$f"
  done
  rm -f "$BOOT/vela-installer.gz"; sync
  green "  Rückgängig gemacht – der Pi startet wieder normal Raspberry Pi OS."
  exit 0
fi

clear
lila "
  V E L A   S E C U R E   ·   U S B - I N S T A L L E R
  ------------------------------------------------------------"

# --- Prüfungen ---
MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unbekannt)"
echo "  Gerät:        $MODEL"
case "$MODEL" in
  *"Raspberry Pi 3"*) ;;
  *) red "  Achtung: Vela ist für den Raspberry Pi 3 gemacht."
     read -r -p "  Trotzdem weitermachen? (j/n) " a; [ "$a" = j ] || exit 1 ;;
esac

ROOTDEV="$(findmnt -no SOURCE /)"
echo "  System läuft von: $ROOTDEV"
case "$ROOTDEV" in
  /dev/mmcblk0p*) ;;
  *) die "Der Pi muss von der SD-Karte gestartet sein (nicht vom USB-Stick)." ;;
esac

case "$(uname -m)" in
  aarch64)       ARCH=arm64 ;;
  armv7l|armv8l) ARCH=armhf ;;
  *) die "Unbekannte Architektur: $(uname -m)" ;;
esac
echo "  Kernel:       $(uname -m) ($ARCH)"

# --- Inhalt dieser Datei auf den Stick auspacken ---
LINE="$(awk '/^__VELA_PAYLOAD__$/ {print NR + 1; exit}' "$SELF")"
[ -n "$LINE" ] || die "Installer-Datei ist beschädigt (kein Inhalt gefunden)."
if ! ( [ -f "$DIR/$IMG.xz.sha256" ] && cd "$DIR" && sha256sum -c --quiet "$IMG.xz.sha256" ) 2>/dev/null; then
  echo
  echo "  Packe Vela auf dem USB-Stick aus (ca. 1–2 Minuten) ..."
  rm -rf "$DIR"; mkdir -p "$DIR"
  tail -n +"$LINE" "$SELF" | tar -x -C "$DIR" || die "Auspacken fehlgeschlagen. Ist genug Platz auf dem Stick (mind. 1 GB frei)?"
  sync
fi

for f in "$IMG.xz" "$IMG.xz.sha256" "$IMG.size" "$IMG.sha256" "vela-installer-$ARCH.gz"; do
  [ -f "$DIR/$f" ] || die "Datei fehlt auf dem Stick: $f"
done

FS="$(findmnt -no FSTYPE -T "$DIR" || true)"
echo "  Stick-Format: ${FS:-?}"
case "$FS" in
  vfat|msdos) ;;
  exfat) echo "  (exFAT: funktioniert meistens – FAT32 ist am sichersten)" ;;
  *) die "Bitte den USB-Stick als FAT32 formatieren (gerade: $FS)." ;;
esac

SD_BYTES=$(( $(cat /sys/block/mmcblk0/size) * 512 ))
NEED=$(cat "$DIR/$IMG.size")
[ "$SD_BYTES" -ge "$NEED" ] || die "SD-Karte zu klein (mind. $((NEED/1000000)) MB)."

echo
echo "  Prüfe das Vela-Image auf dem Stick (dauert ca. 1 Minute) ..."
( cd "$DIR" && sha256sum -c --quiet "$IMG.xz.sha256" ) || die "Das Image ist beschädigt. Bitte vela-installer.run neu auf den Stick kopieren."
green "  Image in Ordnung."

# --- Bestätigung ---
echo
red   "  ACHTUNG: Beim nächsten Neustart wird die SD-Karte KOMPLETT gelöscht"
red   "  und durch Vela Secure ersetzt. Raspberry Pi OS und alle Dateien"
red   "  darauf sind danach weg. Sichere vorher, was du behalten willst!"
echo
read -r -p "  Zum Fortfahren VELA eintippen: " OK
[ "$OK" = VELA ] || { echo "  Abgebrochen – nichts wurde verändert."; exit 1; }

# --- Installer für den nächsten Start einrichten ---
cp "$DIR/vela-installer-$ARCH.gz" "$BOOT/vela-installer.gz"
cp "$BOOT/config.txt"  "$BOOT/config.txt.vela-backup"
cp "$BOOT/cmdline.txt" "$BOOT/cmdline.txt.vela-backup"
printf '\n[all]\n# Vela-Installer (wird nach der Installation entfernt)\ninitramfs vela-installer.gz followkernel\n' >> "$BOOT/config.txt"
echo "console=tty1 loglevel=3 quiet vela_install" > "$BOOT/cmdline.txt"
sync

echo
green "  Alles bereit!"
echo "  Lass den USB-Stick eingesteckt. Der Pi startet neu und installiert"
echo "  Vela (etwa 3–8 Minuten). Danach startet Vela von selbst."
echo "  Vor dem Neustart kannst du noch abbrechen: sudo bash $SELF --undo"
echo
read -r -p "  Jetzt neu starten? (j/n) " R
if [ "$R" = j ]; then reboot; else echo "  Starte später mit:  sudo reboot"; fi
exit 0
