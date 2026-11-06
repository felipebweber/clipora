# Avisos do Deno 2.7.0

`gerar-licencas.mjs` inclui estes avisos no `THIRD_PARTY_LICENSES.txt` do pacote e falha se faltar um insumo obrigatório ou se qualquer hash diferir de `scripts/binarios.lock`. Os arquivos de avisos são texto enxuto: blocos de licença integralmente iguais são deduplicados, e as associações de crate ou caminhos de origem ficam junto do bloco. O JSON bruto do cargo-about é temporário e não é distribuído.

## Fontes fixadas

- Deno v2.7.0: source archive `https://codeload.github.com/denoland/deno/tar.gz/refs/tags/v2.7.0`, SHA-256 `3e8180e19b89a595d051234ff7344e2251ac7529ea6d6a39506cf76310e494e5`; `Cargo.lock` SHA-256 `5c34db249c90bfc351d35a541e817b1f5d28a0e7779777a1503bdbec52b5efdc`; `LICENSE.md` SHA-256 `f62497fffecc0852960c8d3e6934b9db86d16396e9b604072e923892cae3a588`.
- Rusty V8 v145.0.0 source archive: `https://codeload.github.com/denoland/rusty_v8/tar.gz/refs/tags/v145.0.0`, SHA-256 `d00f6ebae3ae3c11fba262e947798c98c93a5b60bae5b0a6230a9df0e9611284`; tag commit `e6a88b35dd3d7f2849a0df33a71d338701c55316`.
- V8 submodule fixado por Rusty V8: commit `8defb67673c5483ae56258a2de01b07e947dc921`; source archive `https://codeload.github.com/denoland/v8/tar.gz/8defb67673c5483ae56258a2de01b07e947dc921`, SHA-256 `7b3d243fb8edf7338e222dd0e396bb3b5d5410e053b7268deb12a0e0709e2546`.
- TypeScript embutido: versão 5.9.2 declarada em `cli/tsc/00_typescript.js` da source archive Deno acima, SHA-256 `e1a0ff47df93e30b2e7e02aae5d6202cb7cf38019408767d3556393d749ef810`. Texto Apache-2.0 da tag Microsoft TypeScript v5.9.2 (`https://github.com/microsoft/TypeScript/blob/v5.9.2/LICENSE.txt`), SHA-256 `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47`.

Os hashes dos avisos gerados e do manifesto dos arquivos fonte também ficam em `scripts/binarios.lock`. `V8-THIRD_PARTY_LICENSES.sources.json` relaciona 504 arquivos de aviso com seus hashes e registra os gitlinks fixados de `v8/` e `third_party/`. `DENO-SOURCE-THIRD_PARTY_LICENSES.sources.json` registra os avisos do source archive e prova os caminhos de TypeScript, Node, Undici e WebGPU.

## Reproduzir

1. Baixe o source archive Deno v2.7.0 pelo URL acima, confira o SHA-256 fixado, extraia em `deno-source/` e confira `Cargo.lock` e `LICENSE.md` pelos hashes acima.
2. Gere o grafo para os mesmos seis alvos de `scripts/binarios.lock` com cargo-about 0.9.2 e a configuração específica do Deno:

   ```sh
   cargo about generate \
     --manifest-path deno-source/cli/Cargo.toml \
     --target aarch64-apple-darwin \
     --target x86_64-apple-darwin \
     --target x86_64-pc-windows-msvc \
     --target aarch64-pc-windows-msvc \
     --target x86_64-unknown-linux-gnu \
     --target aarch64-unknown-linux-gnu \
     --format json \
     --config scripts/licencas/deno/about.toml \
     --locked --fail > /tmp/deno-cargo-about.json
   node scripts/licencas/deno/render-cargo-about.mjs \
     /tmp/deno-cargo-about.json scripts/licencas/deno/CARGO-THIRD_PARTY_LICENSES.txt
   ```

   `render-cargo-about.mjs` confere que todo pacote retornado tem pelo menos uma licença associada, agrupa textos integralmente idênticos e conserva nome, versão, licença e autores Cargo. Licença desconhecida, texto ausente ou associação ausente falha.
3. Baixe/extrai Rusty V8 v145.0.0 e confira seu hash e commit; execute `git submodule update --init --depth 1`. Todos os gitlinks sob `v8/` e `third_party/` devem estar presentes nos commits declarados pela tag. Gere `V8-THIRD_PARTY_LICENSES.txt` com `node scripts/licencas/deno/gerar-v8-avisos.mjs <checkout-rusty-v8> scripts/licencas/deno/V8-THIRD_PARTY_LICENSES.txt`.
4. Baixe `https://raw.githubusercontent.com/microsoft/TypeScript/v5.9.2/LICENSE.txt`, salve como `scripts/licencas/deno/TYPESCRIPT-APACHE-2.0.txt`, confira o hash acima e gere a coleção de avisos da fonte Deno:

   ```sh
   node scripts/licencas/deno/gerar-deno-source-avisos.mjs \
     deno-source scripts/licencas/deno/TYPESCRIPT-APACHE-2.0.txt \
     scripts/licencas/deno/DENO-SOURCE-THIRD_PARTY_LICENSES.txt
   ```

5. Atualize os hashes de saída em `scripts/binarios.lock`, rode `node --test scripts/test-deno-licencas.mjs` e `node scripts/gerar-licencas.mjs --target <triple>`.

## Limites registrados

O coletor V8 percorre nomes License/Copying/Notice/Patents/README.chromium em `v8/` e `third_party/`, inclusive arquivos de teste/build e dependências condicionais. Ele não resolve o grafo de link por alvo, portanto inclui material possivelmente não ligado e não encontra arquivos com nomes não convencionais.

O coletor da fonte Deno percorre nomes convencionais fora de diretórios de teste/benchmark e exige explicitamente o snapshot TypeScript, Node, Undici e WebGPU. Ele não inspeciona avisos inline em cada arquivo, nem prova que todos os avisos de dependências incorporadas estejam sob nomes encontrados. Essas saídas reduzem a lacuna documentada e são verificadas por hash; não são uma declaração de completude legal absoluta.
