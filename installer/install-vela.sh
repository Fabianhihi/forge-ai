#!/bin/bash
# =====================================================================
#  Vela Secure – Ein-Klick-Installer für den Raspberry Pi 3 (B und B+)
#  Läuft unter Raspberry Pi OS (32- oder 64-Bit).
#
#  Einmal starten, den Rest macht er selbst: Vela bauen (falls nötig),
#  als Betriebssystem einrichten, neu starten, auf die SD-Karte schreiben,
#  prüfen und Vela starten.
#
#  Starten:   Doppelklick auf "Vela installieren" oder im Terminal:
#             sudo bash /media/*/*/vela-installer.run
#  Rückgängig (vor dem Neustart):   sudo bash vela-installer.run --undo
# =====================================================================
set -euo pipefail
SELF="$(readlink -f "$0")"
STICK="$(dirname "$SELF")"
DIR="$STICK/.vela-installer"
IMG=vela-secure-pi3.img
LOGF="$STICK/vela-installer.log"
STATUS=/run/vela-installer.status
UNIT=vela-installer
ARG="${1:-}"

log() { echo "$(date '+%F %T') $*" >> "$LOGF" 2>/dev/null || true; }
log "Start – Terminal: $(tty -s && tty || echo keins), Benutzer: $(id -un), Argumente: $*"

# --- Per Doppelklick ohne Terminal gestartet? -> Terminal-Fenster öffnen ---
if [ "$ARG" != "--worker" ] && { [ ! -t 0 ] || [ ! -t 1 ]; }; then
  for T in lxterminal x-terminal-emulator; do
    command -v "$T" >/dev/null 2>&1 && exec "$T" -e "bash '$SELF' --gui"
  done
  command -v foot  >/dev/null 2>&1 && exec foot bash "$SELF" --gui
  command -v xterm >/dev/null 2>&1 && exec xterm -e bash "$SELF" --gui
  log "Kein Terminal-Programm gefunden"
  exit 1
fi

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
lila()  { printf '\033[1;35m%s\033[0m\n' "$*"; }
GUI=0; [ "$ARG" = "--gui" ] && GUI=1
pause_end() { if [ "$GUI" = 1 ]; then echo; read -r -p "  Enter drücken, um das Fenster zu schließen ..." _ || true; fi; }
die() { echo; red "  FEHLER: $*"; log "FEHLER: $*"; echo; pause_end; exit 1; }

# --- Administratorrechte ---
if [ "$(id -u)" != 0 ]; then
  echo "  Vela-Installer braucht Administratorrechte ..."
  exec sudo bash "$SELF" "$@"
fi

BOOT=/boot/firmware
[ -f "$BOOT/config.txt" ] || BOOT=/boot
[ -f "$BOOT/config.txt" ] || die "Boot-Partition nicht gefunden. Läuft hier Raspberry Pi OS?"

# --- Rückgängig machen (nur vor dem Neustart möglich) ---
if [ "$ARG" = "--undo" ]; then
  systemctl stop "$UNIT" 2>/dev/null || true
  for f in config.txt cmdline.txt; do
    [ -f "$BOOT/$f.vela-backup" ] && mv "$BOOT/$f.vela-backup" "$BOOT/$f"
  done
  rm -f "$BOOT/vela-installer.gz"; sync
  green "  Rückgängig gemacht – der Pi startet wieder normal Raspberry Pi OS."
  pause_end; exit 0
fi

case "$(uname -m)" in
  aarch64)       ARCH=arm64 ;;
  armv7l|armv8l) ARCH=armhf ;;
  *) die "Unbekannte Architektur: $(uname -m)" ;;
esac

# =====================================================================
#  WORKER – läuft als Systemdienst im Hintergrund (Fenster darf zu)
# =====================================================================
if [ "$ARG" = "--worker" ]; then
  exec >>"$LOGF" 2>&1
  st()   { echo "$*" > "$STATUS"; echo "$(date '+%F %T') $*"; }
  wdie() { st "FEHLER: $*"; exit 1; }
  trap 'rc=$?; [ $rc = 0 ] || grep -q "^FEHLER" "$STATUS" 2>/dev/null || st "FEHLER: unerwarteter Abbruch (Code $rc) – siehe vela-installer.log"' EXIT

  MARK="$(grep -a -m1 -nE '^__VELA_PAYLOAD_(IMAGE|SOURCE)__$' "$SELF" || true)"
  [ -n "$MARK" ] || wdie "Installer-Datei ist beschädigt. Bitte neu herunterladen."
  LINE=$(( ${MARK%%:*} + 1 ))
  MODE="${MARK#*:}"; MODE="${MODE#__VELA_PAYLOAD_}"; MODE="${MODE%__}"
  mkdir -p "$DIR"

  built_ok() {
    [ -f "$DIR/$IMG" ] && [ -f "$DIR/$IMG.size" ] && [ -f "$DIR/$IMG.sha256" ] && \
    [ -f "$DIR/vela-installer-$ARCH.gz" ] && \
    [ "$(stat -c%s "$DIR/$IMG")" = "$(cat "$DIR/$IMG.size")" ]
  }

  if [ "$MODE" = IMAGE ]; then
    if ! ( [ -f "$DIR/$IMG.xz.sha256" ] && cd "$DIR" && sha256sum -c --quiet "$IMG.xz.sha256" ) 2>/dev/null; then
      st "Packe Vela auf dem USB-Stick aus ..."
      rm -rf "$DIR"; mkdir -p "$DIR"
      tail -n +"$LINE" "$SELF" | tar -x -C "$DIR" || wdie "Auspacken fehlgeschlagen – ist genug Platz auf dem Stick?"
      sync
      st "Prüfe das Vela-Image ..."
      ( cd "$DIR" && sha256sum -c --quiet "$IMG.xz.sha256" ) || wdie "Das Image ist beschädigt. Bitte den Installer neu herunterladen."
    fi
  else
    rm -rf "$DIR/src"; mkdir -p "$DIR/src"
    tail -n +"$LINE" "$SELF" | tar -x -C "$DIR/src" || wdie "Auspacken fehlgeschlagen."
    if ! built_ok; then
      st "Werkzeuge werden installiert ..."
      PKGS="debootstrap debian-archive-keyring parted dosfstools e2fsprogs xz-utils curl gpg gpgv nftables cpio"
      [ "$(uname -m)" = aarch64 ] || PKGS="$PKGS qemu-user-static binfmt-support"
      apt-get update -q || wdie "apt-get update fehlgeschlagen – ist der Pi mit dem Internet verbunden?"
      # shellcheck disable=SC2086
      DEBIAN_FRONTEND=noninteractive apt-get install -y -q $PKGS || wdie "Werkzeuge konnten nicht installiert werden."

      st "Vela wird gebaut ..."
      rm -f "$DIR/$IMG" "$DIR/$IMG.size" "$DIR/$IMG.sha256"
      ( cd "$DIR" && LOCAL_INSTALL_DIR="$DIR" WORK=/var/tmp/vela-build bash "$DIR/src/build.sh" ) > /var/tmp/vela-build.log 2>&1 &
      BP=$!
      while kill -0 "$BP" 2>/dev/null; do
        STEP="$(grep -a '\[vela\]' /var/tmp/vela-build.log 2>/dev/null | tail -1 | sed 's/\x1b\[[0-9;]*m//g; s/^\[vela\] *//' || true)"
        [ -n "$STEP" ] && echo "Bauen: $STEP" > "$STATUS"
        sleep 5
      done
      if ! wait "$BP"; then
        tail -n 30 /var/tmp/vela-build.log
        cp /var/tmp/vela-build.log "$STICK/vela-build.log" 2>/dev/null || true
        wdie "Der Bau ist fehlgeschlagen. Das Protokoll liegt als vela-build.log auf dem Stick."
      fi
      rm -rf /var/tmp/vela-build
      built_ok || wdie "Bau unvollständig – siehe /var/tmp/vela-build.log"
    fi
  fi

  for f in "$IMG.size" "$IMG.sha256" "vela-installer-$ARCH.gz"; do
    [ -f "$DIR/$f" ] || wdie "Datei fehlt auf dem Stick: $f"
  done
  SD_BYTES=$(( $(cat /sys/block/mmcblk0/size) * 512 ))
  NEED=$(cat "$DIR/$IMG.size")
  [ "$SD_BYTES" -ge "$NEED" ] || wdie "SD-Karte zu klein (mind. $((NEED/1000000)) MB)."

  st "Vela wird als Betriebssystem eingerichtet ..."
  cp "$DIR/vela-installer-$ARCH.gz" "$BOOT/vela-installer.gz"
  [ -f "$BOOT/config.txt.vela-backup" ]  || cp "$BOOT/config.txt"  "$BOOT/config.txt.vela-backup"
  [ -f "$BOOT/cmdline.txt.vela-backup" ] || cp "$BOOT/cmdline.txt" "$BOOT/cmdline.txt.vela-backup"
  cp "$BOOT/config.txt.vela-backup" "$BOOT/config.txt"
  printf '\n[all]\n# Vela-Installer (wird nach der Installation entfernt)\ninitramfs vela-installer.gz followkernel\n' >> "$BOOT/config.txt"
  echo "console=tty1 loglevel=3 quiet vela_install" > "$BOOT/cmdline.txt"
  sync
  st "NEUSTART"
  sleep 8
  systemctl reboot
  exit 0
fi

# =====================================================================
#  ANZEIGE – startet den Dienst und zeigt den Fortschritt
# =====================================================================
clear
lila "
  V E L A   S E C U R E   ·   I N S T A L L E R
  ------------------------------------------------------------"

MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unbekannt)"
echo "  Gerät:     $MODEL"
case "$MODEL" in *"Raspberry Pi 3"*) ;; *) red "  Hinweis: Vela ist für den Raspberry Pi 3 gemacht." ;; esac
case "$(findmnt -no SOURCE /)" in
  /dev/mmcblk0p*) ;;
  *) die "Der Pi muss von der SD-Karte gestartet sein (nicht vom USB-Stick)." ;;
esac
FS="$(findmnt -no FSTYPE -T "$STICK" || true)"
case "$FS" in
  vfat|msdos|exfat) ;;
  *) die "Bitte den USB-Stick als FAT32 formatieren (gerade: ${FS:-unbekannt})." ;;
esac

if ! systemctl is-active -q "$UNIT"; then
  if ! grep -aq '^__VELA_PAYLOAD_IMAGE__$' <(head -c 300000 "$SELF"); then
    FREE_STICK=$(df -B1 --output=avail "$STICK" | tail -1)
    [ "$FREE_STICK" -ge 2600000000 ] || [ -f "$DIR/$IMG" ] || die "Zu wenig Platz auf dem USB-Stick (mind. 2,6 GB frei – also ein Stick ab 4 GB)."
    FREE_SD=$(df -B1 --output=avail /var/tmp | tail -1)
    [ "$FREE_SD" -ge 1000000000 ] || [ -f "$DIR/$IMG" ] || die "Zu wenig Platz auf der SD-Karte (mind. 1 GB frei zum Bauen)."
    [ -f "$DIR/$IMG" ] || curl -fsI --max-time 15 https://deb.debian.org >/dev/null 2>&1 \
      || die "Keine Internetverbindung. Bitte LAN-Kabel oder WLAN verbinden und nochmal starten."
  fi

  echo
  red  "  Vela ersetzt jetzt Raspberry Pi OS auf der SD-Karte."
  red  "  Alles auf der SD-Karte wird gelöscht."
  echo
  echo "  Du musst nichts mehr tun. Der Installer baut Vela (falls nötig, ca. 1–2 Std.),"
  echo "  startet den Pi neu, installiert Vela und startet dann Vela."
  echo "  Du kannst dieses Fenster auch schließen – es läuft trotzdem weiter."
  echo
  trap 'echo; echo; green "  Abgebrochen – nichts wurde verändert."; pause_end; exit 1' INT
  for n in 10 9 8 7 6 5 4 3 2 1; do
    printf '\r  Start in %2d s  –  zum Abbrechen  Strg+C  drücken ' "$n"; sleep 1
  done
  trap - INT
  echo; echo
  rm -f "$STATUS"
  systemd-run --unit="$UNIT" --collect --quiet --description="Vela Secure Installer" \
    bash "$SELF" --worker || die "Installer-Dienst konnte nicht gestartet werden."
else
  echo; echo "  Der Installer läuft bereits – ich zeige den Fortschritt."; echo
fi

T0=$(date +%s)
while systemctl is-active -q "$UNIT" 2>/dev/null; do
  S="$(cat "$STATUS" 2>/dev/null || echo "startet ...")"
  [ "$S" = NEUSTART ] && break
  printf '\r  %3d min │ %-62.62s' $(( ($(date +%s) - T0) / 60 )) "$S"
  sleep 3
done
echo
S="$(cat "$STATUS" 2>/dev/null || true)"
case "$S" in
  FEHLER*) echo; red "  $S"; echo; echo "  Raspberry Pi OS ist unverändert. Starte den Installer einfach nochmal."; pause_end; exit 1 ;;
  NEUSTART)
    echo
    green "  ✔ Alles bereit! Der Pi startet jetzt neu und installiert Vela (3–8 Minuten)."
    echo  "    Lass den USB-Stick drin. Danach startet Vela von selbst."
    sleep 30 ;;
  *) echo "  Status: ${S:-unbekannt}"; pause_end ;;
esac
exit 0
