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

FS="$(findmnt -no FSTYPE -T "$(dirname "$SELF")" || true)"
echo "  Stick-Format: ${FS:-?}"
case "$FS" in
  vfat|msdos) ;;
  exfat) echo "  (exFAT: funktioniert meistens – FAT32 ist am sichersten)" ;;
  *) die "Bitte den USB-Stick als FAT32 formatieren (gerade: $FS)." ;;
esac

# --- Inhalt dieser Datei: fertiges Image ODER Bauplan ---
MARK="$(grep -a -m1 -nE '^__VELA_PAYLOAD_(IMAGE|SOURCE)__$' "$SELF" || true)"
[ -n "$MARK" ] || die "Installer-Datei ist beschädigt (kein Inhalt gefunden)."
LINE=$(( ${MARK%%:*} + 1 ))
MODE="${MARK#*:}"; MODE="${MODE#__VELA_PAYLOAD_}"; MODE="${MODE%__}"
mkdir -p "$DIR"

built_ok() {  # Ist Vela auf dem Stick schon fertig gebaut?
  [ -f "$DIR/$IMG" ] && [ -f "$DIR/$IMG.size" ] && [ -f "$DIR/$IMG.sha256" ] && \
  [ -f "$DIR/vela-installer-$ARCH.gz" ] && \
  [ "$(stat -c%s "$DIR/$IMG")" = "$(cat "$DIR/$IMG.size")" ]
}

if [ "$MODE" = IMAGE ]; then
  # Fertiges Image steckt in dieser Datei
  if ! ( [ -f "$DIR/$IMG.xz.sha256" ] && cd "$DIR" && sha256sum -c --quiet "$IMG.xz.sha256" ) 2>/dev/null; then
    echo; echo "  Packe Vela auf dem USB-Stick aus (ca. 1–2 Minuten) ..."
    rm -rf "$DIR"; mkdir -p "$DIR"
    tail -n +"$LINE" "$SELF" | tar -x -C "$DIR" || die "Auspacken fehlgeschlagen. Ist genug Platz auf dem Stick (mind. 1 GB frei)?"
    sync
    ( cd "$DIR" && sha256sum -c --quiet "$IMG.xz.sha256" ) || die "Das Image ist beschädigt. Bitte vela-installer.run neu auf den Stick kopieren."
  fi
  green "  Vela-Image in Ordnung."
else
  # Bauplan: Vela wird jetzt automatisch hier auf dem Pi gebaut
  rm -rf "$DIR/src"; mkdir -p "$DIR/src"
  tail -n +"$LINE" "$SELF" | tar -x -C "$DIR/src" || die "Auspacken fehlgeschlagen."
  if built_ok; then
    green "  Vela ist auf dem Stick schon fertig gebaut – wird direkt verwendet."
  else
    echo
    lila  "  Vela wird jetzt automatisch auf deinem Pi gebaut."
    echo  "  Das dauert etwa 1–2 Stunden. Der Pi braucht Internet (LAN oder WLAN)."
    echo  "  Du kannst ihn einfach laufen lassen. Raspberry Pi OS bleibt dabei unverändert."
    echo
    FREE_STICK=$(df -B1 --output=avail "$DIR" | tail -1)
    [ "$FREE_STICK" -ge 2600000000 ] || die "Zu wenig Platz auf dem USB-Stick (mind. 2,6 GB frei, also ein Stick ab 4 GB)."
    FREE_SD=$(df -B1 --output=avail /var/tmp | tail -1)
    [ "$FREE_SD" -ge 1000000000 ] || die "Zu wenig Platz auf der SD-Karte (mind. 1 GB frei zum Bauen)."
    curl -fsI --max-time 15 https://deb.debian.org >/dev/null 2>&1 || die "Keine Internetverbindung. Bitte LAN oder WLAN verbinden."

    echo "  [1/2] Werkzeuge installieren ..."
    PKGS="debootstrap debian-archive-keyring parted dosfstools e2fsprogs xz-utils curl gpg gpgv nftables cpio"
    [ "$(uname -m)" = aarch64 ] || PKGS="$PKGS qemu-user-static binfmt-support"
    apt-get update -q >/dev/null || die "apt-get update fehlgeschlagen."
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q $PKGS >/dev/null || die "Werkzeuge konnten nicht installiert werden."

    echo "  [2/2] Vela bauen – Protokoll: /var/tmp/vela-build.log"
    rm -f "$DIR/$IMG" "$DIR/$IMG.size" "$DIR/$IMG.sha256"
    ( cd "$DIR" && LOCAL_INSTALL_DIR="$DIR" WORK=/var/tmp/vela-build bash "$DIR/src/build.sh" ) > /var/tmp/vela-build.log 2>&1 &
    BP=$!
    T0=$(date +%s)
    while kill -0 "$BP" 2>/dev/null; do
      STEP="$(grep -a '\[vela\]' /var/tmp/vela-build.log 2>/dev/null | tail -1 | sed 's/\x1b\[[0-9;]*m//g; s/^\[vela\] *//')"
      MIN=$(( ($(date +%s) - T0) / 60 ))
      printf '\r  %3d min │ %-60.60s' "$MIN" "${STEP:-startet ...}"
      sleep 5
    done
    echo
    if ! wait "$BP"; then
      tail -n 15 /var/tmp/vela-build.log
      die "Der Bau ist fehlgeschlagen. Das ganze Protokoll steht in /var/tmp/vela-build.log"
    fi
    rm -rf /var/tmp/vela-build
    built_ok || die "Bau unvollständig – siehe /var/tmp/vela-build.log"
    green "  Vela wurde erfolgreich gebaut!"
  fi
fi

for f in "$IMG.size" "$IMG.sha256" "vela-installer-$ARCH.gz"; do
  [ -f "$DIR/$f" ] || die "Datei fehlt auf dem Stick: $f"
done

SD_BYTES=$(( $(cat /sys/block/mmcblk0/size) * 512 ))
NEED=$(cat "$DIR/$IMG.size")
[ "$SD_BYTES" -ge "$NEED" ] || die "SD-Karte zu klein (mind. $((NEED/1000000)) MB)."

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
