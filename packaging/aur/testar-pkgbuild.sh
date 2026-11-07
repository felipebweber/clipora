#!/usr/bin/env bash
# Testa o PKGBUILD de clipora-bin num contêiner Arch Linux (x86_64): makepkg confere o
# SHA-256 do .deb, monta o pacote, o pacman instala, e todo arquivo instalado precisa ser
# idêntico ao do .deb (o app recusa yt-dlp/Deno alterados).
#
#   packaging/aur/testar-pkgbuild.sh <dir-com-PKGBUILD> <Clipora_X_amd64.deb>
#
# Dentro do contêiner (CI), rode com CLIPORA_DENTRO_DO_ARCH=1; fora, usa o Docker.
set -euo pipefail

dir=$(cd "$1" && pwd)
deb=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")

if [[ "${CLIPORA_DENTRO_DO_ARCH:-}" != 1 ]]; then
  exec docker run --rm --platform linux/amd64 \
    -v "$dir:/pkg:ro" -v "$deb:/deb/$(basename "$deb"):ro" \
    -v "$(cd "$(dirname "$0")" && pwd)/testar-pkgbuild.sh:/testar.sh:ro" \
    -e CLIPORA_DENTRO_DO_ARCH=1 archlinux:latest \
    bash /testar.sh /pkg "/deb/$(basename "$deb")"
fi

pacman -Syu --noconfirm --needed base-devel >/dev/null
useradd -m construtor
trabalho=/home/construtor/clipora-bin
mkdir -p "$trabalho"
cp "$dir/PKGBUILD" "$dir/.SRCINFO" "$trabalho/"
cp "$deb" "$trabalho/"   # o makepkg usa o arquivo local com o nome da fonte, sem baixar
chown -R construtor: "$trabalho"

# --syncdeps exige sudo; instala as dependências antes, como root.
pacman -S --noconfirm --needed gtk3 webkit2gtk-4.1 hicolor-icon-theme >/dev/null
(cd "$trabalho" && runuser -u construtor -- makepkg --noconfirm --cleanbuild)
pacote=$(ls "$trabalho"/clipora-bin-*-x86_64.pkg.tar.zst)
pacman -U --noconfirm "$pacote" >/dev/null
echo "instalado: $(pacman -Q clipora-bin)"

# Conferência byte a byte: arquivos do .deb == arquivos instalados.
ref=$(mktemp -d)
bsdtar -xOf "$deb" 'data.tar.*' | bsdtar -xf - -C "$ref"
divergentes=0
total=0
while IFS= read -r -d '' f; do
  rel=${f#"$ref"}
  total=$((total + 1))
  if ! cmp -s "$f" "$rel"; then
    echo "DIVERGENTE: $rel"
    divergentes=$((divergentes + 1))
  fi
done < <(find "$ref" -type f -print0)
echo "arquivos conferidos: $total, divergentes: $divergentes"
test "$total" -gt 0
test "$divergentes" -eq 0
test -x /usr/bin/clipora
echo "ok: clipora-bin instalado e idêntico ao .deb"
