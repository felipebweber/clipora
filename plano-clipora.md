# Plano de implementação do Clipora

**Objetivo:** criar um aplicativo desktop que baixa, um por vez, vídeos públicos do Instagram Reels e TikTok na melhor qualidade disponível.

**Arquitetura:** interface em React e TypeScript dentro do Tauri; a parte nativa coordena configurações, arquivos e processos locais. O yt-dlp obtém metadados e vídeos; o FFmpeg une vídeo e áudio quando necessário. As versões distribuídas devem incluir as dependências adequadas a cada sistema e arquitetura.

**Tecnologias:** Tauri, Rust, React, TypeScript, yt-dlp e FFmpeg.

**Especificação:** [Projeto da primeira versão](projeto-aplicativo.md).

## Regras gerais

- Compatibilidade pretendida: Windows, macOS e Linux; confirmar sistemas e arquiteturas suportados na etapa de distribuição.
- Interface em português; um download por vez; sem login, conteúdo privado, downloads em lote ou servidor próprio.
- Prévia automática; download apenas após ação do usuário.
- Melhor qualidade que o yt-dlp conseguir obter; não prometer qualidade original nem compatibilidade com todos os vídeos públicos.
- Não sobrescrever arquivos existentes; não atualizar yt-dlp sem ação do usuário.
- Criar o código em `/Users/felipe/Workspace/clipora`; verificar antes se a pasta existe e preservar conteúdo existente.

## 1. Preparar e validar a base

- [ ] Verificar ferramentas instaladas e criar o projeto Tauri com React e TypeScript no diretório combinado, sem substituir arquivos existentes.
- [ ] Configurar comandos de desenvolvimento, compilação e testes; registrar instruções para executar o projeto.
- [ ] Abrir uma janela inicial do Clipora e verificar que a aplicação inicia no ambiente de desenvolvimento.

**Entrega:** projeto executável com uma janela inicial. Os demais sistemas serão verificados nas etapas de distribuição.

## 2. Construir a interface inicial

- [ ] Criar tela com campo de link, área de prévia, botão de download, área de progresso e acesso às configurações.
- [ ] Definir estados claros para aguardando link, carregando prévia, pronto, baixando, concluído e erro; bloquear ações incompatíveis com cada estado.
- [ ] Garantir navegação por teclado, rótulos e mensagens compreensíveis em português.
- [ ] Verificar a navegação e os estados com dados simulados, sem depender de uma plataforma externa.

**Entrega:** interface navegável que demonstra o fluxo completo com dados simulados.

## 3. Integrar o yt-dlp e carregar prévias

- [ ] Definir uma interface interna para solicitar metadados e iniciar downloads, mantendo a interface gráfica separada dos processos locais.
- [ ] Validar links HTTP(S) de Instagram e TikTok, incluindo links curtos conhecidos, e passar argumentos ao processo sem executá-los por um shell.
- [ ] Consultar metadados com yt-dlp ao colar ou alterar um link válido; apresentar título e capa quando disponíveis.
- [ ] Impedir que uma resposta atrasada de um link anterior substitua a prévia do link atual. Informar erro ou ausência de capa sem exibir dados incorretos.
- [ ] Testar URLs inválidas, formatos aceitos, respostas atrasadas e falhas do processo; testar links públicos reais disponíveis.

**Entrega:** prévia real carregada automaticamente para links que o yt-dlp consegue acessar.

## 4. Salvar e alterar a pasta de destino

- [ ] Na primeira tentativa de download, abrir o seletor de pasta do sistema. Se o usuário cancelar, não iniciar o download.
- [ ] Guardar a pasta escolhida localmente; expô-la nas configurações com opção para alterar.
- [ ] Verificar se a pasta existe e pode receber arquivos antes do download; pedir outra se necessário.
- [ ] Testar persistência após reinício, cancelamento, pasta removida e falta de permissão de escrita.

**Entrega:** pasta de destino persistente e configurável.

## 5. Fazer o download e apresentar o resultado

- [ ] Executar o yt-dlp para um único vídeo, selecionando a melhor combinação disponível de vídeo e áudio, com FFmpeg quando a união for necessária.
- [ ] Atualizar o progresso quando informado pelo processo; mostrar estado indeterminado quando não houver percentual confiável.
- [ ] Evitar sobrescrever arquivos existentes, inclusive em tentativas repetidas; não informar sucesso em caso de falha ou arquivo incompleto.
- [ ] Mostrar conclusão e botão para abrir a pasta; apresentar erros de rede, acesso e processamento em linguagem clara.
- [ ] Testar download bem-sucedido, falha, nomes duplicados e indisponibilidade do FFmpeg; validar com links públicos reais de cada plataforma quando possível.

**Entrega:** fluxo completo do link até o arquivo salvo, com progresso e feedback.

## 6. Verificar e atualizar o yt-dlp

- [ ] Definir como consultar a versão instalada e a versão publicada por uma fonte oficial; mostrar aviso quando houver atualização disponível.
- [ ] Permitir que o usuário inicie a atualização, exibindo andamento, sucesso ou erro; nunca instalá-la automaticamente.
- [ ] Investigar e implementar uma forma viável de manter o yt-dlp atualizável fora de diretórios imutáveis ou protegidos, sem alterar o pacote assinado do aplicativo. Verificar origem e integridade dos arquivos obtidos.
- [ ] Impedir atualizações concorrentes com downloads e manter a versão anterior funcional se a atualização falhar.
- [ ] Testar ausência de rede, versão atual, atualização disponível, arquivo inválido e falha durante a instalação. Validar o mecanismo em cada sistema antes de distribuí-lo.

**Entrega:** verificação de versão e atualização manual segura do yt-dlp. Caso uma plataforma imponha limitações, documentar e resolver antes de declarar a funcionalidade pronta nela.

## 7. Preparar distribuição para cada sistema

- [ ] Definir e documentar arquiteturas, versões mínimas dos sistemas, formatos de pacote e origem das versões do yt-dlp e FFmpeg.
- [ ] Preparar empacotamento para Windows, macOS e Linux; incluir as dependências locais necessárias sem exigir instalação manual.
- [ ] Conferir licenças, avisos e obrigações de distribuição dos componentes e das versões escolhidas do FFmpeg.
- [ ] Configurar assinatura e notarização onde forem necessárias ou desejadas; registrar certificados e contas necessários, sem presumir sua disponibilidade.
- [ ] Instalar e executar cada pacote no respectivo sistema; testar prévia, escolha de pasta, download, abertura de pasta e atualização manual.

**Entrega:** pacotes por sistema efetivamente testados, com limitações e requisitos de assinatura documentados.

## 8. Revisão final

- [ ] Executar testes automatizados e compilação; corrigir falhas encontradas.
- [ ] Revisar experiência visual, teclado, mensagens, permissões e tratamento de erros.
- [ ] Documentar instalação, uso, atualização do yt-dlp, limitações conhecidas e como relatar problemas.
- [ ] Fazer uma verificação final por sistema com vídeos públicos de teste disponíveis; registrar o que não puder ser validado.

**Entrega:** primeira versão documentada e verificável, com resultados reais de testes e pendências explícitas.

## Critérios de conclusão

A primeira versão estará pronta quando o usuário puder instalar o Clipora em cada plataforma suportada, colar um link público compatível, conferir a prévia, escolher a pasta na primeira vez, baixar o vídeo, abrir a pasta e atualizar manualmente o yt-dlp após receber um aviso. Falhas das plataformas devem ser comunicadas claramente. A validação de cada sistema só será declarada após teste no próprio sistema.
