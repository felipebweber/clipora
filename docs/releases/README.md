# Notas de release

Cada arquivo `vX.Y.Z.md` desta pasta é o texto da release do GitHub da tag de mesmo nome. O job `release` de `.github/workflows/build.yml` o usa ao publicar.

Para lançar uma versão:

1. Atualize a versão em `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
2. Escreva `docs/releases/vX.Y.Z.md`. Os nomes dos arquivos citados devem seguir os da release anterior, trocando a versão.
3. Faça o commit, crie a tag `vX.Y.Z` e envie a tag. O CI compila, confere, atesta e publica a release.

Sem o arquivo de notas, o CI cria a release como rascunho, com notas automáticas, para você revisar e publicar à mão.
