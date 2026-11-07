# Pacote AUR `clipora-bin` (Arch Linux e derivadas)

O `clipora-bin` reaproveita o `.deb` publicado na release do GitHub: o PKGBUILD baixa o `.deb`, confere o SHA-256 e extrai os arquivos sem alterá-los. O `options=('!strip' '!debug')` é obrigatório: o Clipora confere o hash do yt-dlp e do Deno embutidos e recusa binários modificados (foi por isso que o AppImage foi removido).

## Arquivos

- `PKGBUILD.in`: modelo. Edite este arquivo, nunca o PKGBUILD gerado.
- `../../scripts/gerar-pkgbuild.mjs`: gera `PKGBUILD` e `.SRCINFO` a partir dos dois `.deb` (x86_64 e aarch64).
- `testar-pkgbuild.sh`: em um contêiner `archlinux`, roda `makepkg`, instala com `pacman -U` e compara byte a byte os arquivos instalados com os do `.deb`.

O CI (job `aur` em `.github/workflows/build.yml`) faz as três coisas a cada build e publica o resultado como o artefato `aur-clipora-bin`. O teste em Arch roda só em x86_64; o aarch64 usa o mesmo PKGBUILD com o `.deb` arm64.

## Publicar uma versão

Pré-requisitos (uma vez só, feitos pelo mantenedor): conta em <https://aur.archlinux.org>, chave SSH cadastrada nela e o nome `clipora-bin` livre (o primeiro push cria o pacote).

1. Publique a release `vX.Y.Z` no GitHub com `Clipora_X.Y.Z_amd64.deb` e `Clipora_X.Y.Z_arm64.deb`, **os mesmos arquivos** do build que gerou o artefato `aur-clipora-bin` (os hashes precisam bater).
2. Baixe o artefato `aur-clipora-bin` desse build. Ou gere localmente:

   ```sh
   node scripts/gerar-pkgbuild.mjs --deb-x86_64 Clipora_X.Y.Z_amd64.deb --deb-aarch64 Clipora_X.Y.Z_arm64.deb --saida /tmp/clipora-bin
   ```

3. Envie para o AUR:

   ```sh
   git clone ssh://aur@aur.archlinux.org/clipora-bin.git
   cp /tmp/clipora-bin/PKGBUILD /tmp/clipora-bin/.SRCINFO clipora-bin/
   cd clipora-bin && git add PKGBUILD .SRCINFO && git commit -m "Atualiza para X.Y.Z" && git push
   ```

Para republicar a mesma versão com mudança só no PKGBUILD, aumente o `pkgrel` no modelo.
