# Textos de licença vendorizados

Usados por `scripts/gerar-licencas.mjs` para montar `src-tauri/binaries/licencas/THIRD_PARTY_LICENSES.txt`.

| Arquivo | Origem | SHA-256 |
|---|---|---|
| `GPL-3.0.txt` | `COPYING.GPLv3` do tarball `ffmpeg-8.1.3.tar.xz` (SHA-256 e assinatura GPG verificados por `compilar-ffmpeg.mjs`) | `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903` |
| `LGPL-2.1.txt` | `COPYING.LGPLv2.1` do mesmo tarball | `246041b6ecf9bc32d718a62c57877c78b5eb397b6467e74ed7ae2626ab189c30` |
| `about.toml` | configuração do cargo-about (licenças aceitas e exceções por crate) | — |

Os textos são os oficiais da FSF, sem alterações. Para conferir: `shasum -a 256 scripts/licencas/*.txt`.
