#!/usr/bin/env bash
# =====================================================================
#  Vela Linux – Secure Tor Edition (Desktop-OS) · Image-Builder für Raspberry Pi 3
# ---------------------------------------------------------------------
#  Baut ein flashbares SD-Karten-Image (vela-secure-pi3.img.xz):
#    * Debian (trixie) arm64 minimal, Raspberry-Pi-Firmware + Kernel
#    * Tor Browser (offizielle ARM64-Version, Signatur wird geprüft)
#    * Desktop (labwc): Fenster, Leiste, Startmenü, Dateien, Terminal,
#      Editor, Rechner – Tor Browser als Standardbrowser, ohne Passwort
#    * Firewall-Killswitch: NUR Tor darf ins Internet
#    * Kein SSH, root gesperrt, Bluetooth aus, Logs nur im RAM,
#      zufällige MAC-Adresse, Kernel-Härtung, tägliche Updates über Tor
#
#  Start (auf Linux, als root):   sudo ./build.sh
#  Benötigt: debootstrap parted dosfstools e2fsprogs xz-utils curl gpg
#            debian-archive-keyring  (+ qemu-user-static auf x86-PCs)
# =====================================================================
set -euo pipefail

SUITE="${SUITE:-trixie}"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"
IMG_SIZE="${IMG_SIZE:-1900M}"
OUT="${OUT:-vela-secure-pi3.img}"
MAX_XZ_MB="${MAX_XZ_MB:-430}"
VUSER="vela"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HERE/work}"
ROOT="$WORK/root"
TB_DIST="https://dist.torproject.org/torbrowser"
TB_FPR="EF6E286DDA85EA2A4BA7DE684E2C6E8793298290"   # Tor Browser Developers

say() { printf '\n\033[1;35m[vela]\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m[vela] FEHLER:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Bitte mit sudo starten: sudo ./build.sh"
for t in debootstrap parted mkfs.vfat mkfs.ext4 losetup xz curl gpg gpgv fstrim; do
  command -v "$t" >/dev/null || die "Programm fehlt: $t"
done
if [ "$(dpkg --print-architecture 2>/dev/null || uname -m)" != arm64 ] && [ "$(uname -m)" != aarch64 ]; then
  [ -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ] || \
    die "Kein ARM-Rechner: bitte 'qemu-user-static binfmt-support' installieren"
fi
KEYRING=/usr/share/keyrings/debian-archive-keyring.gpg
[ -f "$KEYRING" ] || die "debian-archive-keyring fehlt"

LOOP=""
cleanup() {
  set +e
  for m in boot/firmware dev/pts dev proc sys run; do
    mountpoint -q "$ROOT/$m" && umount -l "$ROOT/$m"
  done
  mountpoint -q "$ROOT" && umount -l "$ROOT"
  [ -n "$LOOP" ] && losetup -d "$LOOP" 2>/dev/null
}
trap cleanup EXIT

# ---------------------------------------------------------------------
say "1/7  Tor Browser (ARM64) suchen, laden und Signatur prüfen"
mkdir -p "$WORK/dl"
if [ -z "${TB_VERSION:-}" ]; then
  for v in $(curl -fsSL "$TB_DIST/" | grep -oE 'href="[0-9]+\.[0-9]+(\.[0-9]+)*/"' \
             | grep -oE '[0-9]+(\.[0-9]+)+' | sort -Vr); do
    if curl -fsIL "$TB_DIST/$v/tor-browser-linux-aarch64-$v.tar.xz" >/dev/null 2>&1; then
      TB_VERSION="$v"; break
    fi
  done
fi
[ -n "${TB_VERSION:-}" ] || die "Keine stabile Tor-Browser-ARM64-Version gefunden"
TB_TAR="tor-browser-linux-aarch64-$TB_VERSION.tar.xz"
say "     Tor Browser $TB_VERSION"
[ -f "$WORK/dl/$TB_TAR" ] || curl -fL -o "$WORK/dl/$TB_TAR" "$TB_DIST/$TB_VERSION/$TB_TAR"
curl -fsSL -o "$WORK/dl/$TB_TAR.asc" "$TB_DIST/$TB_VERSION/$TB_TAR.asc"

export GNUPGHOME="$WORK/gnupg"; rm -rf "$GNUPGHOME"; mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --auto-key-locate nodefault,wkd --locate-keys torbrowser@torproject.org >/dev/null 2>&1 \
  || curl -fsSL "https://keys.openpgp.org/vks/v1/by-fingerprint/$TB_FPR" | gpg --batch --quiet --import
gpg --batch --list-keys --with-colons | grep -q "fpr:::::::::$TB_FPR:" \
  || die "Tor-Signaturschlüssel hat falschen Fingerabdruck!"
gpg --batch --export "$TB_FPR" > "$WORK/tor.keyring"
gpgv --keyring "$WORK/tor.keyring" "$WORK/dl/$TB_TAR.asc" "$WORK/dl/$TB_TAR" \
  || die "Signatur des Tor Browsers ist UNGÜLTIG – Abbruch!"
say "     Signatur OK"

# ---------------------------------------------------------------------
say "2/7  Image anlegen und partitionieren"
rm -f "$OUT" "$OUT.xz"
truncate -s "$IMG_SIZE" "$OUT"
parted -s "$OUT" mklabel msdos \
  mkpart primary fat32 4MiB 260MiB \
  mkpart primary ext4 260MiB 100%
LOOP="$(losetup -fP --show "$OUT")"
sleep 1
mkfs.vfat -F 32 -n RASPIFIRM "${LOOP}p1" >/dev/null
mkfs.ext4 -q -L RASPIROOT "${LOOP}p2"
mkdir -p "$ROOT"
mount "${LOOP}p2" "$ROOT"

# Doku, Manpages und fremde Sprachen gar nicht erst installieren (spart Platz)
mkdir -p "$ROOT/etc/dpkg/dpkg.cfg.d"
cat > "$ROOT/etc/dpkg/dpkg.cfg.d/01-vela-slim" <<'EOF'
path-exclude=/usr/share/doc/*
path-include=/usr/share/doc/*/copyright
path-exclude=/usr/share/man/*
path-exclude=/usr/share/info/*
path-exclude=/usr/share/locale/*
path-include=/usr/share/locale/de/*
path-include=/usr/share/locale/en/*
path-include=/usr/share/locale/locale.alias
path-exclude=/usr/share/lintian/*
EOF

# ---------------------------------------------------------------------
say "3/7  Debian $SUITE (arm64) Grundsystem installieren – dauert etwas"
DBS_SCRIPT=""
[ -e "/usr/share/debootstrap/scripts/$SUITE" ] || DBS_SCRIPT=/usr/share/debootstrap/scripts/sid
debootstrap --arch=arm64 --variant=minbase --keyring="$KEYRING" \
  --components=main,non-free-firmware \
  --include=ca-certificates,apt-utils,util-linux,kmod,udev,dbus,systemd,systemd-sysv \
  "$SUITE" "$ROOT" "$MIRROR" $DBS_SCRIPT

mkdir -p "$ROOT/boot/firmware"
mount "${LOOP}p1" "$ROOT/boot/firmware"
for m in dev dev/pts proc sys run; do mount --bind "/$m" "$ROOT/$m"; done

cat > "$ROOT/etc/apt/sources.list" <<EOF
deb $MIRROR $SUITE main non-free-firmware
deb $MIRROR $SUITE-updates main non-free-firmware
deb http://security.debian.org/debian-security $SUITE-security main non-free-firmware
EOF
echo vela > "$ROOT/etc/hostname"
printf '127.0.0.1\tlocalhost\n127.0.1.1\tvela\n::1\tlocalhost ip6-localhost ip6-loopback\n' > "$ROOT/etc/hosts"
cat > "$ROOT/etc/fstab" <<'EOF'
LABEL=RASPIROOT  /              ext4  defaults,noatime,commit=60        0 1
LABEL=RASPIFIRM  /boot/firmware vfat  defaults,noatime,umask=0077       0 2
tmpfs            /tmp           tmpfs defaults,nosuid,nodev,size=128M   0 0
EOF
# Kein Dienst darf während des Baus starten
printf '#!/bin/sh\nexit 101\n' > "$ROOT/usr/sbin/policy-rc.d"; chmod +x "$ROOT/usr/sbin/policy-rc.d"

# ---------------------------------------------------------------------
say "4/7  Kernel, Firmware, Tor, Firewall und Oberfläche installieren"
in_root() { LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive chroot "$ROOT" /bin/bash -c "$*"; }
in_root "apt-get update"
in_root "apt-get install -y --no-install-recommends \
  linux-image-arm64 raspi-firmware firmware-brcm80211 wireless-regdb \
  systemd-resolved systemd-timesyncd libpam-systemd wpasupplicant \
  tor apt-transport-tor nftables apparmor apparmor-profiles \
  labwc waybar foot fuzzel mako-notifier swaybg xdg-utils \
  pcmanfm mousepad galculator imv grim slurp \
  adwaita-icon-theme fonts-dejavu-core fonts-noto-color-emoji fontconfig zram-tools \
  cloud-guest-utils fdisk e2fsprogs xz-utils locales"

# Bibliotheken, die Firefox ESR braucht (= Basis des Tor Browsers), ohne Firefox selbst
LIBS="$(in_root "apt-cache depends --no-recommends --no-suggests --no-conflicts --no-breaks \
         --no-replaces --no-enhances firefox-esr" \
        | awk '$1 ~ /Depends:/ && $2 !~ /^</ {print $2}' | grep -E '^lib' | sort -u | tr '\n' ' ')"
in_root "apt-get install -y --no-install-recommends $LIBS libdbus-glib-1-2 libpci3 || true"

# Raspberry-Pi-Bootkonfiguration
cat > "$ROOT/etc/default/raspi-firmware" <<'EOF'
ROOTPART=LABEL=RASPIROOT
CONSOLES="tty1"
EOF
cat > "$ROOT/etc/default/raspi-firmware-custom" <<'EOF'
# Vela Secure
disable_splash=1
gpu_mem=64
hdmi_force_hotplug=1
EOF
echo "quiet loglevel=3 apparmor=1 security=apparmor init_on_alloc=1 init_on_free=1 slab_nomerge page_alloc.shuffle=1 randomize_kstack_offset=on" \
  > "$ROOT/etc/default/raspi-extra-cmdline"
in_root "for k in /boot/vmlinuz-*; do /etc/kernel/postinst.d/z50-raspi-firmware \${k#/boot/vmlinuz-}; done"

# BusyBox (64- und 32-Bit) für den USB-Installer holen – landet nicht im Image
in_root "dpkg --add-architecture armhf && apt-get update -q && cd /tmp && apt-get download busybox-static:arm64 busybox-static:armhf"
mkdir -p "$WORK/bb"; rm -f "$WORK"/bb/*.deb
mv "$ROOT"/tmp/busybox-static_*.deb "$WORK/bb/"
in_root "dpkg --remove-architecture armhf"

# ---------------------------------------------------------------------
say "5/7  Tor Browser einbauen"
mkdir -p "$ROOT/opt"
tar -xJf "$WORK/dl/$TB_TAR" -C "$ROOT/opt"
[ -d "$ROOT/opt/tor-browser" ] || mv "$ROOT"/opt/tor-browser* "$ROOT/opt/tor-browser"
MISSING="$(in_root "ldd /opt/tor-browser/Browser/firefox* /opt/tor-browser/Browser/libxul.so 2>/dev/null | grep 'not found' | sort -u" || true)"
[ -z "$MISSING" ] || { echo "$MISSING"; die "Dem Tor Browser fehlen Bibliotheken (siehe oben)"; }

# ---------------------------------------------------------------------
say "6/7  Sicherheit & Vela-Konfiguration"
in_root "useradd -m -s /bin/bash -G video,render,input,audio,debian-tor $VUSER"
in_root "passwd -l root >/dev/null; passwd -d $VUSER >/dev/null; usermod -L $VUSER"
in_root "chown -R $VUSER:$VUSER /opt/tor-browser"
in_root "sed -i 's/^# *de_DE.UTF-8/de_DE.UTF-8/' /etc/locale.gen && locale-gen >/dev/null && update-locale LANG=de_DE.UTF-8"
echo 'KEYMAP=de' > "$ROOT/etc/vconsole.conf"
ln -sf /usr/share/zoneinfo/Europe/Berlin "$ROOT/etc/localtime"

# --- Tor (System-Dienst; der Browser nutzt ihn) ---
cat > "$ROOT/etc/tor/torrc" <<'EOF'
# Vela Secure – System-Tor
SocksPort 9050 IsolateSOCKSAuth IsolateDestAddr
ControlPort 9051
CookieAuthentication 1
CookieAuthFile /run/tor/control.authcookie
CookieAuthFileGroupReadable 1
AvoidDiskWrites 1
ClientUseIPv6 1
Log notice syslog
EOF
mkdir -p "$ROOT/etc/systemd/system/tor@default.service.d"
cat > "$ROOT/etc/systemd/system/tor@default.service.d/vela-killswitch.conf" <<'EOF'
# Tor startet NUR, wenn die Firewall geladen ist (Killswitch)
[Unit]
Requires=nftables.service
After=nftables.service
EOF

# --- Firewall: nur Tor darf raus ---
cat > "$ROOT/etc/nftables.conf" <<'EOF'
#!/usr/sbin/nft -f
# Vela Secure Firewall – alles zu, nur Tor darf ins Internet
flush ruleset
table inet vela {
  chain input {
    type filter hook input priority 0; policy drop;
    iif lo accept
    ct state established,related accept
    ct state invalid drop
    icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept
  }
  chain forward {
    type filter hook forward priority 0; policy drop;
  }
  chain output {
    type filter hook output priority 0; policy drop;
    oif lo accept
    ct state established,related accept
    meta skuid "debian-tor" accept                      # Tor
    meta skuid "systemd-timesync" udp dport 123 accept  # Uhrzeit (Pi hat keine Batterie-Uhr)
    meta skuid "systemd-resolve" meta l4proto { tcp, udp } th dport 53 accept  # nur für Uhrzeit-Server
    udp sport 68 udp dport 67 accept                    # DHCP
    icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit } accept
    counter drop
  }
}
EOF

# --- Netzwerk: LAN + WLAN mit zufälliger MAC ---
mkdir -p "$ROOT/etc/systemd/network"
cat > "$ROOT/etc/systemd/network/10-vela-random-mac.link" <<'EOF'
[Match]
Type=wlan
[Link]
MACAddressPolicy=random
NamePolicy=kernel
EOF
cat > "$ROOT/etc/systemd/network/20-vela.network" <<'EOF'
[Match]
Name=e* wl*
[Network]
DHCP=yes
IPv6PrivacyExtensions=yes
LLMNR=no
MulticastDNS=no
[DHCPv4]
SendHostname=no
UseHostname=no
[DHCPv6]
SendHostname=no
EOF
mkdir -p "$ROOT/etc/systemd/resolved.conf.d"
printf '[Resolve]\nLLMNR=no\nMulticastDNS=no\nDNSSEC=allow-downgrade\n' > "$ROOT/etc/systemd/resolved.conf.d/vela.conf"

# --- WLAN beim ersten Start aus vela-wlan.txt (Boot-Partition) übernehmen ---
cat > "$ROOT/boot/firmware/vela-wlan.txt" <<'EOF'
# Vela Secure – WLAN einrichten
# Trage hier dein WLAN ein (vor dem ersten Start, z. B. am PC).
# Die Datei wird beim Start gelesen und danach sicher gelöscht.
# Ohne WLAN-Daten einfach leer lassen und ein LAN-Kabel benutzen.
SSID=
PASSWORT=
LAND=DE
EOF
cat > "$ROOT/usr/local/sbin/vela-wlan" <<'EOF'
#!/bin/sh
F=/boot/firmware/vela-wlan.txt
[ -f "$F" ] || exit 0
SSID="$(sed -n 's/^SSID=//p' "$F" | tr -d '\r')"
PW="$(sed -n 's/^PASSWORT=//p' "$F" | tr -d '\r')"
LAND="$(sed -n 's/^LAND=//p' "$F" | tr -d '\r')"; [ -n "$LAND" ] || LAND=DE
if [ -n "$SSID" ]; then
  C=/etc/wpa_supplicant/wpa_supplicant-wlan0.conf
  umask 077
  { echo "ctrl_interface=DIR=/run/wpa_supplicant GROUP=netdev"; echo "country=$LAND"
    echo "mac_addr=1"; echo "preassoc_mac_addr=1"
    if [ -n "$PW" ]; then wpa_passphrase "$SSID" "$PW" | grep -v '#psk='
    else printf 'network={\n\tssid="%s"\n\tkey_mgmt=NONE\n}\n' "$SSID"; fi
  } > "$C"
  systemctl enable --now wpa_supplicant@wlan0.service
fi
# Passwort nicht im Klartext liegen lassen
{ echo "# WLAN wurde übernommen. Für ein neues WLAN wieder ausfüllen."; echo "SSID="; echo "PASSWORT="; echo "LAND=$LAND"; } > "$F.new"
mv "$F.new" "$F"; sync
EOF
cat > "$ROOT/etc/systemd/system/vela-wlan.service" <<'EOF'
[Unit]
Description=Vela: WLAN aus vela-wlan.txt übernehmen
After=local-fs.target
Before=network-pre.target
Wants=network-pre.target
ConditionPathExists=/boot/firmware/vela-wlan.txt
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/vela-wlan
[Install]
WantedBy=multi-user.target
EOF

# --- Erster Start: SD-Karte voll nutzen ---
cat > "$ROOT/usr/local/sbin/vela-grow" <<'EOF'
#!/bin/sh
ROOTDEV="$(findmnt -no SOURCE /)"
DISK="/dev/$(lsblk -no pkname "$ROOTDEV")"
PART="$(echo "$ROOTDEV" | grep -oE '[0-9]+$')"
growpart "$DISK" "$PART" && resize2fs "$ROOTDEV"
systemctl disable vela-grow.service
EOF
cat > "$ROOT/etc/systemd/system/vela-grow.service" <<'EOF'
[Unit]
Description=Vela: Dateisystem auf ganze SD-Karte vergrößern
After=local-fs.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/vela-grow
[Install]
WantedBy=multi-user.target
EOF

# --- Automatische Sicherheitsupdates – über Tor ---
sed -i 's#^deb http#deb tor+http#' "$ROOT/etc/apt/sources.list"
cat > "$ROOT/etc/systemd/system/vela-update.service" <<'EOF'
[Unit]
Description=Vela: System-Updates über Tor
After=tor@default.service
Requires=tor@default.service
[Service]
Type=oneshot
Environment=DEBIAN_FRONTEND=noninteractive
ExecStart=/usr/bin/apt-get update -q
ExecStart=/usr/bin/apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
ExecStartPost=/usr/bin/apt-get clean
EOF
cat > "$ROOT/etc/systemd/system/vela-update.timer" <<'EOF'
[Unit]
Description=Vela: tägliche Updates
[Timer]
OnBootSec=20min
OnUnitActiveSec=1d
RandomizedDelaySec=30min
[Install]
WantedBy=timers.target
EOF

# --- Kernel- & Netzwerk-Härtung ---
cat > "$ROOT/etc/sysctl.d/99-vela-hardening.conf" <<'EOF'
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
kernel.yama.ptrace_scope = 2
kernel.perf_event_paranoid = 3
kernel.sysrq = 0
kernel.kexec_load_disabled = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.all.use_tempaddr = 2
net.ipv6.conf.default.use_tempaddr = 2
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_timestamps = 0
net.ipv4.icmp_echo_ignore_all = 1
vm.swappiness = 100
EOF
cat > "$ROOT/etc/modprobe.d/vela-blacklist.conf" <<'EOF'
# Bluetooth aus (Angriffsfläche)
install bluetooth /bin/false
install btbcm /bin/false
install hci_uart /bin/false
install btusb /bin/false
# Selten genutzte Netzwerkprotokolle aus
install dccp /bin/false
install sctp /bin/false
install rds /bin/false
install tipc /bin/false
EOF
mkdir -p "$ROOT/etc/systemd/journald.conf.d"
printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=16M\n' > "$ROOT/etc/systemd/journald.conf.d/vela.conf"
mkdir -p "$ROOT/etc/systemd/coredump.conf.d"
printf '[Coredump]\nStorage=none\n' > "$ROOT/etc/systemd/coredump.conf.d/vela.conf"
printf 'ALGO=zstd\nPERCENT=75\nPRIORITY=100\n' > "$ROOT/etc/default/zramswap"

# --- Desktop: ohne Passwort direkt auf den Vela-Desktop ---
mkdir -p "$ROOT/etc/systemd/system/getty@tty1.service.d"
cat > "$ROOT/etc/systemd/system/getty@tty1.service.d/vela-autologin.conf" <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $VUSER --noclear --skip-login %I \$TERM
EOF

# Tor Browser als Programm + Standardbrowser
cat > "$ROOT/usr/local/bin/tor-browser" <<'EOF'
#!/bin/sh
# Tor Browser über den System-Tor starten
export MOZ_ENABLE_WAYLAND=1
export TOR_SKIP_LAUNCH=1
export TOR_SOCKS_HOST=127.0.0.1 TOR_SOCKS_PORT=9050
export TOR_CONTROL_HOST=127.0.0.1 TOR_CONTROL_PORT=9051
export TOR_CONTROL_COOKIE_AUTH_FILE=/run/tor/control.authcookie
cd /opt/tor-browser/Browser || exit 1
exec ./start-tor-browser --detach "$@"
EOF
cat > "$ROOT/usr/share/applications/vela-tor-browser.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Tor Browser
GenericName=Webbrowser
Comment=Anonym im Internet surfen
Exec=/usr/local/bin/tor-browser %u
Icon=/opt/tor-browser/Browser/browser/chrome/icons/default/default128.png
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=Tor Browser
EOF
cat > "$ROOT/usr/share/applications/vela-status.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Vela Sicherheitsstatus
Comment=Tor, Firewall und Schutzfunktionen anzeigen
Exec=foot -H vela-status
Icon=security-high
Categories=System;
EOF
cat > "$ROOT/usr/local/bin/vela-status" <<'EOF'
#!/bin/sh
# Kurzer Sicherheitsbericht für das Terminal
ok() { printf '  \033[32m●\033[0m %-26s %s\n' "$1" "$2"; }
no() { printf '  \033[31m●\033[0m %-26s %s\n' "$1" "$2"; }
printf '\n  \033[1;35mVELA SECURE\033[0m  %s\n\n' "$(cat /etc/vela-release 2>/dev/null)"
systemctl is-active -q tor@default && ok "Tor" "verbunden (SOCKS 127.0.0.1:9050)" || no "Tor" "NICHT aktiv"
systemctl is-active -q nftables && ok "Killswitch-Firewall" "aktiv – nur Tor darf raus" || no "Firewall" "NICHT aktiv"
systemctl is-active -q ssh 2>/dev/null && no "SSH" "läuft!" || ok "SSH / Fernzugriff" "aus"
lsmod | grep -q '^bluetooth' && no "Bluetooth" "an" || ok "Bluetooth" "aus"
aa-enabled -q 2>/dev/null && ok "AppArmor" "aktiv" || ok "AppArmor" "(Status nur als root lesbar)"
ok "Logs" "nur im RAM"
ok "Updates" "täglich über Tor"
printf '\n  Arbeitsspeicher: %s\n\n' "$(free -h | awk '/Mem/{print $3" / "$2}')"
EOF

# labwc-Desktop (Fenster, Leiste, Startmenü) für den Benutzer
H="$ROOT/home/$VUSER"
mkdir -p "$H/.config/labwc" "$H/.config/waybar" "$H/.config/foot" "$H/.config/fuzzel" \
         "$H/.config/mako" "$H/Dokumente" "$H/Downloads" "$H/Bilder" "$H/Schreibtisch"
cat > "$H/.config/labwc/environment" <<'EOF'
XKB_DEFAULT_LAYOUT=de
WLR_RENDERER=pixman
WLR_NO_HARDWARE_CURSORS=1
MOZ_ENABLE_WAYLAND=1
BROWSER=/usr/local/bin/tor-browser
XDG_CURRENT_DESKTOP=Vela:wlroots
EOF
cat > "$H/.config/labwc/autostart" <<'EOF'
swaybg -c '#1a1230' &
waybar &
mako &
# Tor Browser direkt beim Start öffnen
sleep 2 && /usr/local/bin/tor-browser &
EOF
cat > "$H/.config/labwc/rc.xml" <<'EOF'
<?xml version="1.0"?>
<labwc_config>
  <theme><name>Adwaita-dark</name><cornerRadius>8</cornerRadius>
    <font place=""><name>DejaVu Sans</name><size>10</size></font></theme>
  <keyboard>
    <default />
    <keybind key="W-space"><action name="Execute" command="fuzzel" /></keybind>
    <keybind key="W-Return"><action name="Execute" command="foot" /></keybind>
    <keybind key="W-b"><action name="Execute" command="/usr/local/bin/tor-browser" /></keybind>
    <keybind key="W-e"><action name="Execute" command="pcmanfm" /></keybind>
    <keybind key="W-q"><action name="Close" /></keybind>
    <keybind key="Print"><action name="Execute" command="sh -c 'grim ~/Bilder/Bildschirm-$(date +%F-%H%M%S).png'" /></keybind>
  </keyboard>
</labwc_config>
EOF
cat > "$H/.config/labwc/menu.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu>
  <menu id="root-menu" label="Vela">
    <item label="Tor Browser"><action name="Execute" command="/usr/local/bin/tor-browser" /></item>
    <item label="Dateien"><action name="Execute" command="pcmanfm" /></item>
    <item label="Terminal"><action name="Execute" command="foot" /></item>
    <item label="Texteditor"><action name="Execute" command="mousepad" /></item>
    <item label="Rechner"><action name="Execute" command="galculator" /></item>
    <separator />
    <item label="Sicherheitsstatus"><action name="Execute" command="foot -H vela-status" /></item>
    <separator />
    <item label="Neu starten"><action name="Execute" command="systemctl reboot" /></item>
    <item label="Ausschalten"><action name="Execute" command="systemctl poweroff" /></item>
  </menu>
</openbox_menu>
EOF
cat > "$H/.config/waybar/config.jsonc" <<'EOF'
{
  "position": "top", "height": 30,
  "modules-left": ["custom/menu", "wlr/taskbar"],
  "modules-center": ["clock"],
  "modules-right": ["custom/tor", "network", "memory", "custom/power"],
  "custom/menu":  { "format": "◉ Vela", "on-click": "fuzzel", "tooltip": false },
  "wlr/taskbar":  { "on-click": "activate", "on-click-middle": "close", "icon-size": 18 },
  "clock":        { "format": "{:%a %d. %b  %H:%M}", "locale": "de_DE.UTF-8" },
  "custom/tor":   { "exec": "systemctl is-active -q tor@default && echo '🧅 Tor' || echo '⚠ Tor aus'",
                    "interval": 10, "on-click": "foot -H vela-status" },
  "network":      { "format-wifi": "📶 {essid}", "format-ethernet": "🔌 LAN", "format-disconnected": "✕ Offline" },
  "memory":       { "format": "RAM {used:0.1f}G" },
  "custom/power": { "format": "⏻", "on-click": "labwc --exit", "tooltip": false }
}
EOF
cat > "$H/.config/waybar/style.css" <<'EOF'
* { font-family: "DejaVu Sans", "Noto Color Emoji"; font-size: 13px; }
window#waybar { background: #110d1c; color: #ece9f5; }
#custom-menu { color: #c49ae8; font-weight: bold; padding: 0 12px; }
#custom-tor { color: #b78be0; padding: 0 10px; }
#clock, #network, #memory, #custom-power { padding: 0 10px; }
#taskbar button { color: #ece9f5; padding: 0 6px; }
#taskbar button.active { background: #7d469855; border-radius: 6px; }
EOF
printf '[main]\nfont=DejaVu Sans Mono:size=11\n[colors]\nbackground=110d1c\nforeground=ece9f5\n' > "$H/.config/foot/foot.ini"
printf '[main]\nfont=DejaVu Sans:size=12\nprompt="Vela › "\n[colors]\nbackground=15131fee\ntext=ece9f5ff\nselection=7d4698ff\nborder=a86fd0ff\n' > "$H/.config/fuzzel/fuzzel.ini"
printf 'background-color=#1d1a2a\ntext-color=#ece9f5\nborder-color=#a86fd0\nborder-radius=8\ndefault-timeout=5000\n' > "$H/.config/mako/config"
cat > "$H/Schreibtisch/Willkommen.txt" <<'EOF'
Willkommen bei Vela Secure!

Alle Internetverbindungen laufen über Tor. Die Firewall blockiert alles andere.

Tastenkürzel:
  Super + Leertaste   Programme starten
  Super + B           Tor Browser
  Super + Enter       Terminal
  Super + E           Dateien
  Super + Q           Fenster schließen
  Druck               Bildschirmfoto (in ~/Bilder)
  Rechtsklick auf den Desktop öffnet das Vela-Menü.
EOF
cat > "$H/.bash_profile" <<'EOF'
if [ "$(tty)" = /dev/tty1 ]; then
  clear; echo "  Vela Secure wird gestartet ..."
  exec labwc
fi
EOF
in_root "su -s /bin/sh $VUSER -c 'xdg-mime default vela-tor-browser.desktop x-scheme-handler/http x-scheme-handler/https text/html' || true"
chmod 755 "$ROOT"/usr/local/bin/vela-* "$ROOT"/usr/local/bin/tor-browser "$ROOT"/usr/local/sbin/vela-*
in_root "chown -R $VUSER:$VUSER /home/$VUSER"

cat > "$ROOT/etc/issue" <<'EOF'

  VELA LINUX · Secure Tor Edition
  Alle Verbindungen laufen über Tor.

EOF
cp "$ROOT/etc/issue" "$ROOT/etc/motd"

# Dienste
in_root "systemctl enable nftables.service tor.service systemd-networkd.service systemd-resolved.service \
  systemd-timesyncd.service apparmor.service zramswap.service vela-wlan.service vela-grow.service vela-update.timer"
in_root "systemctl mask ssh.service bluetooth.service wpa_supplicant.service 2>/dev/null || true"
ln -sf /run/systemd/resolve/stub-resolv.conf "$ROOT/etc/resolv.conf"

# Firewall-Regeln testen
in_root "nft -c -f /etc/nftables.conf" || say "     Warnung: Firewall-Regeln konnten hier nicht geprüft werden (Emulator). Tor startet nur bei geladener Firewall."

# ---------------------------------------------------------------------
say "7/7  Aufräumen, verkleinern, komprimieren"
rm -f "$ROOT/usr/sbin/policy-rc.d"
in_root "apt-get clean"
rm -rf "$ROOT"/var/lib/apt/lists/* "$ROOT"/var/cache/* "$ROOT"/var/log/*.log "$ROOT"/tmp/* "$ROOT"/root/.bash_history
: > "$ROOT/etc/machine-id"
rm -f "$ROOT/var/lib/dbus/machine-id"
echo "Vela Secure (Tor Browser $TB_VERSION) – gebaut $(date -u +%F)" > "$ROOT/etc/vela-release"
df -h "$ROOT" | tail -1
fstrim "$ROOT" || true
sync
cleanup; LOOP=""; trap - EXIT

IMG_BYTES=$(stat -c%s "$OUT")
IMG_SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"

make_initramfs() {  # $1 = Zielordner
  command -v cpio >/dev/null || die "Programm fehlt: cpio"
  for A in arm64 armhf; do
    R="$WORK/initramfs-$A"; X="$WORK/bbx-$A"
    rm -rf "$R" "$X"; mkdir -p "$R"/bin "$R"/dev "$R"/proc "$R"/sys "$R"/tmp "$R"/stick "$R"/sdboot "$R"/sdroot "$R"/lib/modules
    dpkg-deb -x "$(ls "$WORK"/bb/busybox-static_*_"$A".deb)" "$X"
    BB="$(find "$X" -type f -name busybox | head -1)"
    [ -n "$BB" ] || die "BusyBox ($A) nicht gefunden"
    install -m 755 "$BB" "$R/bin/busybox"
    install -m 755 "$HERE/installer/init" "$R/init"
    mknod -m 600 "$R/dev/console" c 5 1
    mknod -m 666 "$R/dev/null" c 1 3
    (cd "$R" && find . | cpio -o -H newc --quiet | gzip -9) > "$1/vela-installer-$A.gz"
  done
}

# --- Bau direkt am Pi (vom Installer gestartet): unkomprimiert auf den Stick ---
if [ -n "${LOCAL_INSTALL_DIR:-}" ]; then
  say "Installer-Dateien auf den USB-Stick schreiben"
  make_initramfs "$LOCAL_INSTALL_DIR"
  [ "$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")" = "$LOCAL_INSTALL_DIR/vela-secure-pi3.img" ] || \
    mv "$OUT" "$LOCAL_INSTALL_DIR/vela-secure-pi3.img"
  echo "$IMG_SHA  vela-secure-pi3.img" > "$LOCAL_INSTALL_DIR/vela-secure-pi3.img.sha256"
  echo "$IMG_BYTES" > "$LOCAL_INSTALL_DIR/vela-secure-pi3.img.size"
  sync
  say "Fertig gebaut."
  exit 0
fi

xz -T0 -9 --check=crc32 -f "$OUT"
sha256sum "$OUT.xz" > "$OUT.xz.sha256"
SIZE_MB=$(( $(stat -c%s "$OUT.xz") / 1024 / 1024 ))
say "Fertig: $OUT.xz  ($SIZE_MB MB)"
if [ "$SIZE_MB" -gt "$MAX_XZ_MB" ]; then
  die "Image ist $SIZE_MB MB und damit größer als $MAX_XZ_MB MB!"
fi

# ---------------------------------------------------------------------
say "USB-Installer zusammenstellen"
INST="$WORK/installer-payload"
rm -rf "$INST"; mkdir -p "$INST"
make_initramfs "$INST"
ln -f "$OUT.xz" "$INST/$OUT.xz" 2>/dev/null || cp "$OUT.xz" "$INST/$OUT.xz"
(cd "$INST" && sha256sum "$OUT.xz") > "$INST/$OUT.xz.sha256"
echo "$IMG_BYTES" > "$INST/$OUT.size"
echo "$IMG_SHA  $OUT" > "$INST/$OUT.sha256"
# Eine einzige Datei: Installer-Skript + angehängter Inhalt
RUN="$HERE/vela-installer.run"
{ cat "$HERE/installer/install-vela.sh"; echo "__VELA_PAYLOAD_IMAGE__"; tar -C "$INST" -cf - .; } > "$RUN"
chmod 755 "$RUN"
say "Fertig: vela-installer.run  ($(( $(stat -c%s "$RUN") / 1024 / 1024 )) MB) – auf einen USB-Stick kopieren"
say "Fertig! Zwei Wege:"
say "  A) $OUT.xz mit dem Raspberry Pi Imager auf SD-Karte oder USB-Stick flashen"
say "  B) vela-installer.run auf einen USB-Stick kopieren und am Pi starten"
