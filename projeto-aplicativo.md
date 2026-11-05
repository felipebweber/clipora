# Clipora — projeto da primeira versão

## Objetivo
Aplicativo de computador para Windows, macOS e Linux que salva um vídeo público por vez do Instagram Reels ou TikTok a partir de um link. O processamento ocorre no computador, sem servidor próprio. O projeto será criado em `/Users/felipe/Workspace/clipora`.

## Funcionamento
- Colar um link e carregar automaticamente uma prévia com título e imagem de capa.
- Baixar um vídeo público por vez, sem login e sem suporte a conteúdo privado.
- Selecionar automaticamente a melhor qualidade de vídeo e áudio disponível ao mecanismo e unir os arquivos quando necessário.
- Solicitar a pasta de destino no primeiro download, armazená-la localmente e permitir alterá-la nas configurações. Se a pasta deixar de estar disponível, pedir outra.
- Mostrar progresso, conclusão e erros compreensíveis; oferecer um botão para abrir a pasta de destino após a conclusão.
- Não sobrescrever arquivos existentes; escolher outro nome.
- Avisar quando houver nova versão do yt-dlp e permitir ao usuário iniciar a atualização no próprio aplicativo; não instalar automaticamente.
- Interface em português. Não incluir download em lote, login, histórico sincronizado ou servidor nesta primeira versão.

## Abordagens
Foi escolhida uma aplicação desktop com processamento local, em vez de um servidor que exigiria hospedagem e receberia os links. Para a interface, foram consideradas Tauri, PySide6 e Electron; a opção escolhida foi Tauri com React e TypeScript.

## Implementação proposta
Usar Tauri para a aplicação desktop, React e TypeScript para a interface, yt-dlp para obtenção dos vídeos e FFmpeg quando necessário para unir vídeo e áudio. Distribuir os componentes necessários para cada sistema e arquitetura, sem exigir instalação manual de dependências pelo usuário. Verificar licenças e viabilidade de atualização do yt-dlp empacotado em cada sistema antes da distribuição.

O acesso depende das plataformas: mesmo vídeos públicos podem exigir autenticação, ter restrições ou deixar de funcionar após mudanças no serviço. A aplicação deve explicar falhas, inclusive ao obter prévias, sem prometer que todos os links funcionarão. A qualidade é a melhor disponibilizada ao yt-dlp, não necessariamente a do original.

## Verificação
Testar validação de links, prévia, persistência e alteração da pasta, progresso, colisão de nomes, erros e atualização iniciada pelo usuário. Verificar a integração com vídeos públicos disponíveis. Gerar e testar pacotes em cada sistema antes de afirmar compatibilidade completa.
