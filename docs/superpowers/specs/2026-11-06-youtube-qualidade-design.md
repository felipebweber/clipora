# YouTube: vídeos normais e seleção de qualidade

## Estado e decisões

Desenho revisado tecnicamente e aprovado pelo usuário em 2026-11-06.
Ainda não implementado no aplicativo. O preflight isolado comprovou downloads
anônimos em duas resoluções; ver `docs/youtube-preflight.md`. Complementa o MVP sem alterar `projeto-aplicativo.md`
ou `plano-clipora.md`.

O usuário pediu vídeos normais do YouTube e um seletor de qualidade exclusivo
para essa plataforma. Excluiu Shorts e delegou ao coordenador a escolha do melhor
comportamento do seletor. A escolha do coordenador é uma lista dinâmica das
resoluções disponíveis, com **Melhor disponível** como padrão.

São propostas do coordenador: manter um vídeo por vez, salvar MP4 com áudio,
reaproveitar prévia/histórico, limitar esta evolução a acesso sem autenticação
e excluir transmissões e estreias ainda não disponíveis como vídeo normal.
Stories permanece pendente nos registros próprios; esta evolução não implementa
login nem habilita stories.

## Intenção

Permitir economizar espaço ou escolher maior definição ao baixar um vídeo do
YouTube, com a mesma simplicidade de colar um link já usada no Clipora.

## Abordagens consideradas

1. Lista fixa de resoluções: simples, mas pode anunciar uma qualidade inexistente
   e exigir uma substituição inesperada no download.
2. Perfis como econômica/equilibrada/máxima: poucos controles, mas não deixam
   explícita a resolução que a pessoa está escolhendo.
3. Resoluções descobertas na prévia: só apresenta combinações elegíveis naquele
   vídeo e permite uma escolha precisa. **Escolha do coordenador**, por delegação
   do usuário; aproveita os metadados que já são obtidos pelo yt-dlp.

## Comportamento da qualidade

- Campo **Qualidade** disponível somente após uma prévia válida do YouTube.
- Padrão **Melhor disponível**, seguido das resoluções elegíveis em ordem
  decrescente. Exemplos: 2160p (4K), 1440p, 1080p, 720p, 480p, 360p. A lista não
  possui teto artificial de 1080p ou 4K e não inclui níveis ausentes.
- Uma opção por altura real em pixels; deduplicar formatos de mesma altura.
  Não arredondar uma altura incomum para uma resolução que ela não representa.
  Não oferecer codecs, FPS, trilhas de áudio ou tamanho estimado como controles
  adicionais nesta evolução.
- Uma resolução explícita exige essa altura exata. Escolher a melhor combinação
  elegível dentro dela, preferindo maior FPS e depois os critérios de qualidade
  do yt-dlp. **Melhor disponível** prioriza a maior altura elegível e aplica o
  mesmo desempate. Não fazer upscale nem transcodificar.
- Qualidade indisponível entre a prévia e o download retorna
  `QUALIDADE_INDISPONIVEL`: **Essa qualidade não está mais disponível. Atualize a
  prévia e escolha outra.** Não baixar silenciosamente em outra resolução.
- Trocar o link reinicia a seleção em Melhor disponível e invalida a lista
  anterior imediatamente. Respostas atrasadas não restauram seleções/listas
  de outro vídeo.
- Trocar a qualidade não pede nova prévia nem modifica o link. Fica desabilitada
  durante o download. Ao terminar, baixar novamente o mesmo vídeo preserva a
  escolha; atualizar a prévia a reinicia em Melhor disponível.
- Retentativa de download e seleção de nova pasta preservam a escolha capturada
  para aquela tentativa; cada chamada IPC continua criando um Channel novo.
- Instagram e TikTok continuam com o comportamento automático atual e não
  recebem parâmetros de qualidade do YouTube.

## Links e elegibilidade

- Aceitar `https://youtube.com/watch?v=<id>`, aliases `www`/`m`, e
  `https://youtu.be/<id>`. ID estrito de 11 caracteres ASCII alfanuméricos,
  `_` ou `-`. Aceitar HTTP somente com normalização para HTTPS antes da rede,
  conforme a regra atual. Rejeitar credenciais e portas explícitas.
- No domínio completo, aceitar apenas `/watch` (com barra final opcional) com
  exatamente um parâmetro `v`; no curto, apenas um segmento de ID. Hostnames
  parecidos, embeds, redirecionadores e outras plataformas não são aliases.
- Normalizar para `https://www.youtube.com/watch?v=<id>`. Parâmetros de horário,
  playlist, compartilhamento e fragmentos não alteram o item: baixar o vídeo
  completo, nunca a playlist nem somente um trecho. Preservar o link original
  separadamente, como já ocorre nas demais plataformas.
- Rejeitar `/shorts/`, `/live/`, playlists sem um vídeo, canais e buscas.
  Revalidar o tipo retornado pelo extrator: um Short compartilhado como `/watch`
  ou `youtu.be` também deve ser recusado. Não usar duração/proporção como prova
  de que o conteúdo é um Short.
- Exigir metadados que identifiquem um vídeo normal (`media_type=video` e
  `live_status=not_live`), com ID coerente com a URL, duração finita positiva e
  formatos elegíveis. Campo de classificação ausente não autoriza adivinhar;
  retornar `CONTEUDO_NAO_SUPORTADO` e preservar possibilidade de atualizar o
  yt-dlp. Lives, gravações classificadas como livestream, processamento de
  lives e estreias futuras ficam fora desta primeira evolução.
- Conteúdo que exija login, seja privado, indisponível ou limitado pela plataforma
  recebe erro compreensível. Nenhum acesso a sessão do navegador ou credenciais.
  Repetir as regras de elegibilidade ao iniciar o download; não confiar somente
  no frontend ou numa prévia antiga.

## Formatos e arquivo final

Manter o FFmpeg mínimo atual para remux: saída MP4, vídeo e áudio, sem codificador
nem conversão de resolução. Considerar elegíveis combinações não DRM com vídeo
AVC/H.264, VP9 ou AV1 que possam ser remuxadas em MP4, junto de áudio AAC/MP4A
(incluído no mesmo formato ou separado). A preferência de codec dentro da mesma
altura/FPS é AVC, depois VP9 e AV1. Essa política é uma decisão técnica do
coordenador para reaproveitar o pacote e favorecer compatibilidade; a lista
reflete o que esse caminho suporta, não todos os formatos anunciados pelo site.

Formatos sem dimensão confiável, áudio isolado, imagens/storyboards, DRM e
combinações que precisem de transcodificação não geram opções. A prévia falha
com conteúdo não suportado se não houver combinação elegível com áudio. Se o
extrator não conseguir acessar formatos completos, não inventar resoluções.

Conferir o resultado com o FFprobe empacotado: MP4 regular não vazio, uma faixa
de vídeo e uma de áudio, altura correspondente à escolha explícita. Só então
finalizar e registrar no histórico; falha remove apenas temporários desta
tentativa. Preservar prevenção de colisões e abertura por ID. Conteiner MP4 não
garante que todo player tenha o decoder de VP9/AV1; registrar codecs realmente
testados e limitações nos sistemas suportados.

**Revisão 2026-11-07 (compatibilidade com QuickTime):** VP9/AV1 remuxados em MP4
não abrem no QuickTime nem no player padrão do Windows. A preferência passou a
ser H.264 antes de FPS na mesma altura, e **Melhor compatível** (antes "Melhor
disponível") escolhe a maior altura em H.264; VP9/AV1 só sem H.264. Alturas sem
H.264 (no YouTube, acima de 1080p) seguem escolhíveis com aviso "pode exigir
VLC" (`qualidadesYoutubeCompativeis`). Fora do YouTube, o seletor padrão também
prioriza H.264, mesmo com resolução menor (Reels: 720p H.264 em vez de 1080p
VP9; TikTok: 540p H.264 em vez de 720p HEVC).

## Divisão técnica e contratos propostos

- Novo módulo Rust `src-tauri/src/youtube.rs` concentra classificação, extração
  das opções e construção da seleção de formatos. Não criar outro gerenciador
  de downloads. `links.rs` continua validando URLs para todas as plataformas.
- Adicionar `youtube` a `Plataforma` em Rust/TS e ao contrato canônico. Estender
  `Previa` com `qualidadesYoutube: number[] | null`: alturas elegíveis, positivas,
  únicas, em ordem decrescente; `null` para as outras plataformas.
- `iniciar_download` recebe `alturaYoutube?: number | null`. Ausência/null significa
  Melhor disponível; altura explícita deve ser inteiro positivo elegível para o
  vídeo atual. Recusar altura não nula nas outras plataformas. Não aceitar IDs de
  formato, expressões `-f`, URLs de mídia ou argumentos executáveis vindos da UI.
- Para YouTube, preparar metadados frescos no backend antes do download, validar
  ID/tipo e resolução, construir internamente o filtro e usar a seleção resultante.
  Se formatos mudarem novamente, falhar sem fallback para outra resolução.
- Capturar a altura no estado da tentativa em Rust e React. Expor
  `alturaYoutube: number | null` em download ativo/resultado terminal para
  recuperação de janela, mesmo se a prévia estiver ausente; nessas condições
  mostrar apenas o estado recuperado, sem seletor editável. Retentativas não
  podem perder a altura escolhida.
- Novo componente `src/componentes/SeletorQualidadeYoutube.tsx`, usando select
  nativo com rótulo visível. O hook/reducer possui a seleção e sua invalidação;
  a camada Tauri apenas transporta os dados. O serviço simulado reproduz opções,
  falhas e retentativas do serviço real.
- Histórico usa a chave `youtube:<id>` para reconhecer aliases e ignorar
  rastreamento. Aviso continua por vídeo, independentemente da qualidade, e não
  bloqueia nova cópia. Não adicionar qualidade persistida ao histórico nesta
  evolução: manter leitura dos registros existentes e a abertura de MP4 por ID.
- Para nomes YouTube, preferir título significativo do vídeo e incluir `[id]`;
  usar canal como fallback antes de `Vídeo [id]`. Preservar limites, sanitização
  e sufixos de colisão existentes. Não usar a descrição longa como título.

## Motor JavaScript e distribuição

Os scripts EJS já estão presentes no manifesto do yt-dlp empacotado. O motor
JavaScript externo ainda precisa ser distribuído e resolvido pelo Clipora.
Preferência técnica: **Deno**, recomendado pelo upstream, em versão fixada que
atenda ao yt-dlp empacotado, com URL/hash/licenças registrados no lock do projeto.

Resolver o executável empacotado pelo caminho absoluto e passá-lo explicitamente
via `--js-runtimes`; não depender de Node/Deno instalado no computador. Não
habilitar download remoto de scripts, plugins arbitrários ou atualizações do
motor fora do fluxo de distribuição.

Resolver e verificar o Deno **somente na prévia e no download do YouTube**.
Não o exigir nem passar argumentos de motor nas chamadas de Instagram/TikTok.
Se o Deno estiver ausente, inválido ou inutilizável, apenas o fluxo do YouTube
retorna erro de dependência em português, sem recorrer ao PATH e sem tratar
isso como erro de rede. A conferência de pacote continua exigindo o motor para
um instalador que anuncia suporte ao YouTube.

Antes de ativar uma atualização do yt-dlp, verificar localmente a compatibilidade
do candidato/EJS com o motor fixado. Essa verificação não depende da resposta
ao vivo do YouTube; versão/requisitos e um teste local do solver devem ser
definidos no plano. **Recusar a ativação de um candidato incompatível** e manter
o ponteiro e o binário anterior para todas as plataformas, inclusive após
reinício. Não ativar a atualização deixando apenas o YouTube quebrado. Retornar
`ATUALIZACAO_NAO_SUPORTADA`, com texto contextual explicando que a versão exige
atualizar o Clipora. Se faltar o motor ou não for possível verificar a
compatibilidade local, igualmente não trocar o ponteiro; distinguir esse motivo
da falha de integridade e preservar a instalação anterior. Testar essas recusas
sem alterar os downloads existentes de Instagram/TikTok.

A escolha exata de versão/assets e o novo código de erro da dependência ficam
com Estaleiro/Ferrugem durante o plano técnico, após verificar compatibilidade
dos alvos e dos mínimos já definidos. Não elevar mínimo de sistema nem decidir
novas arquiteturas por conveniência. Antes da integração, comprovar que o
conjunto yt-dlp/EJS/motor/FFmpeg produz uma lista útil e baixa áudio+vídeo em
ao menos duas resoluções. Se a plataforma bloquear o acesso sem login, registrar
o bloqueio e não introduzir autenticação para cumprir esta entrega.

## Aceitação e sequência pretendida

1. Validar dependências e acesso anônimo reais em pasta isolada; fixar o motor
   compatível com os alvos de distribuição existentes e manter as licenças.
2. Ferrugem: contrato, URLs, classificação, opções, seleção efetiva de formatos,
   execução e integração com histórico/estado recuperado. Vitral: tipos,
   transporte, simulador, seleção no reducer/hook, componente acessível e textos.
3. Testes Rust: URLs/aliases/query duplicada/hosts falsos, Shorts por alias,
   livestream/estreia/classificação ausente, formatos com áudio ou sem áudio,
   DRM/storyboard, lista deduplicada, altura exata, falha de qualidade sem
   fallback, título/canal e histórico antigo. Motor ausente afeta apenas YouTube;
   atualização incompatível ou não verificável preserva ponteiro/binário anterior
   de todas as plataformas, inclusive após reinício. Verificar argumentos reais
   enviados ao processo e impedir download de múltiplos itens.
4. Testes React: seletor exclusivo do YouTube, padrão/lista/teclado, reset ao
   trocar link, respostas atrasadas, payload por tentativa, recuperação sem
   prévia, retentativa de pasta e duplicidade sem perder qualidade. Regressão
   Instagram/TikTok. Falha de dependência, login e qualidade indisponível com
   mensagens recuperáveis adequadas ao contexto.
5. Lince revisa integração; Timoneiro verifica frontend/Rust/scripts/CI por
   conta própria antes de commits de implementação. Estaleiro atualiza guia,
   conferência de pacote e licenças. Agentes não fazem commits.
6. Build de commit final em worktree separado. Download real em Melhor disponível
   e numa resolução menor; verificar dimensões e faixas com FFprobe, nomes,
   colisões, histórico/reinício e abertura pelo app. Testar rejeição de Short e
   live sem iniciar download. Registrar o que não puder ser executado.

Segue vigente a exigência do usuário: validar Windows e Linux antes de push
ou publicação. MacOS sozinho não conclui a entrega multiplataforma.

## Referências primárias

- [Seleção e filtros do yt-dlp](https://github.com/yt-dlp/yt-dlp#format-selection).
- [Classificação de vídeo/short/livestream na versão 2026.10.26](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/youtube/_video.py).
- [Requisitos EJS e motores JavaScript](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

Consultadas em 2026-11-06. Suporte upstream não substitui teste com o binário
efetivamente distribuído pelo Clipora.

## Fechamento da revisão técnica

Parecer independente de Lince em `.maestri/revisao-youtube-design-lince.md`:
duas lacunas de decisão, resolvidas pelo coordenador por delegação do usuário:
recusar a atualização incompatível preservando a instalação anterior e exigir
o Deno somente nos fluxos de conteúdo do YouTube. Não houve mudança de escopo
de produto. Versão/assets/licenças do motor, código de erro de dependência e
detalhes dos filtros/teste local ficam para o plano técnico, sujeitos aos
critérios descritos acima.
