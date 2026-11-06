# Teste exploratório de stories sem login

Executado por Timoneiro em 2026-11-06, entre 15:42:56 e 15:43:04 UTC
(12:42:56–12:43:04 em São Paulo), com o yt-dlp **2026.10.26** empacotado no
Clipora, no macOS arm64. Nenhuma alteração no código do aplicativo.

## Método

Execução direta de `src-tauri/binaries/yt-dlp/yt-dlp`, fora da interface do app,
para verificar extração de metadados antes de tentar baixar mídia. Configurações,
plugins, cache e importação de cookies desativados explicitamente. Sem fornecer
usuário, senha, arquivo de cookies ou sessão de navegador. Cada processo usa uma
sessão nova; cookies anônimos recebidos durante a requisição podem ser utilizados
normalmente em memória.

```sh
src-tauri/binaries/yt-dlp/yt-dlp \
  --ignore-config --no-plugin-dirs --no-cache-dir \
  --no-cookies --no-cookies-from-browser --no-update \
  --socket-timeout 12 --retries 0 --extractor-retries 0 \
  --skip-download --dump-single-json --no-playlist --playlist-end 2 \
  -- 'https://www.instagram.com/stories/nasa/'
```

Mesmo comando para os demais endereços abaixo. Timeout externo de 40 segundos
por processo. O limite de dois itens restringe eventual descoberta; não transforma
links de perfil em links individuais aceitos pelo app.

## Resultados observados

| Tentativa | Resultado | Saída | Duração |
| --- | --- | --- | --- |
| `https://www.instagram.com/stories/nasa/` | Exigência de login, sem metadados de story | 1 | 2,14 s |
| `https://www.instagram.com/stories/natgeo/` | Exigência de login, sem metadados de story | 1 | 2,09 s |
| `https://www.instagram.com/reel/DUl354timp1/` — controle | Metadados obtidos: MP4, 12 formatos | 0 | 3,82 s |

As duas tentativas de stories retornaram:

```text
ERROR: [instagram:story] You need to log in to access this content.
```

Os três processos terminaram sem timeout. O controle demonstra que a ferramenta
conseguiu acessar um Reel anonimamente nesta execução; não demonstra acesso a
stories nem sucesso no download do arquivo de controle.

Evidências locais com argumentos, horários, códigos e erro completo:
`.maestri/stories-sem-login/resumo.json` e um JSON por tentativa na mesma pasta.
As evidências não guardam cookies, URLs assinadas de mídia nem o JSON bruto do Reel.

## Conclusão e limites

**Não foi comprovado suporte a stories sem login.** A descoberta de stories nos
dois perfis consultados foi bloqueada com exigência de autenticação. Nenhuma mídia
de story foi obtida, identificada como foto/vídeo ou baixada.

Na rodada inicial não foi possível confirmar se esses perfis tinham stories
ativos, nem testar um link individual ativo de foto e outro de vídeo. Os links
da tabela acima são sondagens de
descoberta, não a entrada por link individual definida para a funcionalidade.
Portanto, o resultado não prova que todo story exige login, não distingue
expiração/ausência/restrição e não valida o fluxo completo do Clipora.

Para completar a avaliação, foram solicitados ao usuário links individuais de um
story de foto e outro de vídeo ainda ativos. O primeiro link recebido foi testado
na rodada complementar abaixo. Se os metadados forem acessíveis,
o passo seguinte é baixar e conferir a mídia em pasta de teste isolada. O extrator
de vídeo atual, sozinho, não atende à extração de fotos.

Permanece a decisão de [escopo](stories-escopo.md): nenhuma autenticação nesta
versão; suporte a login registrado para o próximo desenvolvimento. Caso os links
individuais também exijam login, manter stories pendente. Adicionar login no futuro
não é garantia de resolver todos os bloqueios da plataforma.

## Rodada complementar — link individual enviado pelo usuário

Em 2026-11-06, entre 16:11:06 e 16:11:09 UTC (13:11:06–13:11:09 em São Paulo),
foi testado o story `4023965144282765165`, do perfil `roberto_brandini`.
Mesmo binário 2026.10.26 e isolamento de autenticação da rodada inicial.

| Variante do link | Resultado | Saída | Duração |
| --- | --- | --- | --- |
| Link original enviado pelo usuário, com parâmetros de compartilhamento | Exigência de login | 1 | 1,61 s |
| `https://www.instagram.com/stories/roberto_brandini/4023965144282765165/`, sem parâmetros | Exigência de login | 1 | 1,15 s |

Mensagem retornada nas duas tentativas:

```text
ERROR: [instagram:story] 4023965144282765165: You need to log in to access this content.
```

Ambas usaram `--no-playlist --skip-download --dump-single-json`; o limite
`--playlist-end 2` da sondagem de perfis foi omitido. Timeout externo de 45 segundos;
nenhum timeout ocorreu. Nenhuma mídia foi baixada: a extração dos metadados falhou
antes dessa etapa. Não foi possível identificar se o story era foto ou vídeo,
confirmar sua validade atual nem determinar se o erro é uma restrição do conteúdo
ou uma limitação do extrator. Não houve teste autenticado.

Evidências locais: `.maestri/stories-sem-login/story-roberto-original.json` e
`.maestri/stories-sem-login/story-roberto-sem-rastreamento.json`. O link completo
de compartilhamento permanece somente na evidência local; a variante sem parâmetros
acima identifica o mesmo item para repetição.

**Conclusão desta rodada:** o link individual fornecido não foi acessado sem login
pelo yt-dlp atual do Clipora. Remover os parâmetros não alterou o resultado. Ainda
não há evidência de um download de story de foto ou vídeo sem autenticação; manter
a funcionalidade pendente, conforme o escopo decidido pelo usuário.
