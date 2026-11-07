# Guia do Clipora

O Clipora baixa um vídeo público por vez do Instagram Reels, TikTok e YouTube. No YouTube, use o link de um vídeo normal público; não é necessário entrar na sua conta. O vídeo é processado no seu computador.

## Instalação

Instale o pacote publicado para seu sistema e arquitetura: Windows x64/arm64 (`.exe` NSIS; MSI x64 opcional), macOS (`.dmg`) ou Linux (`.deb` ou `.rpm`). Use apenas os downloads e hashes publicados pelo projeto. O projeto ainda não tem página de releases pública; o primeiro CI ainda não foi executado, e a compatibilidade real de cada sistema depende de testes nesse sistema.

- **Windows**: abra o instalador e siga as etapas. Sem assinatura Authenticode, o Windows pode mostrar avisos do SmartScreen; o Smart App Control pode impedir a execução.
- **macOS**: abra o `.dmg` e arraste Clipora para Aplicativos. Uma release sem assinatura Developer ID e notarização pode ser bloqueada pelo Gatekeeper. Não há conta nem certificado configurados neste momento.
- **Linux**: use o formato disponível para sua distribuição e arquitetura. O sistema precisa dos componentes WebKitGTK compatíveis com o pacote; consulte os pré-requisitos do pacote da release.

Não instale um pacote cujo hash publicado não confira. Não há atualização automática do próprio Clipora nesta versão.

## Baixar um vídeo

1. Cole o link de um vídeo público do Instagram Reels, TikTok ou YouTube no campo principal. Para o YouTube, use o endereço normal do vídeo, como `youtube.com/watch?v=...` ou `youtu.be/...`. O Clipora carrega a prévia quando consegue acessar o link sem login.
2. Confira a prévia. Para vídeos do YouTube, o seletor **Qualidade** aparece com **Melhor compatível** e as alturas realmente disponíveis naquele vídeo. Alturas marcadas com **pode exigir VLC** só existem em VP9/AV1 no YouTube (em geral, acima de 1080p). Escolha uma altura para pedir exatamente essa resolução; o Clipora não troca silenciosamente para outra. Para Instagram e TikTok, a qualidade continua automática.
3. Selecione **Baixar**.
4. Na primeira vez, escolha uma pasta de destino. O Clipora guarda essa preferência localmente. Altere-a em **Configurações** quando precisar.
5. Acompanhe o progresso. Ao concluir, use **Abrir vídeo** para assistir ou **Abrir pasta** para localizar o arquivo.

O Clipora salva um vídeo por vez. Em todas as plataformas, o Clipora prioriza vídeo H.264 com áudio AAC, que abre no QuickTime e no player padrão do Windows, mesmo que isso signifique uma resolução menor (por exemplo, 720p em vez de 1080p em Reels). Só usa VP9/AV1 quando o vídeo não tem versão H.264. No YouTube, procura a melhor combinação dentro da altura escolhida, preferindo H.264 a um FPS maior; em **Melhor compatível**, escolhe a maior altura em H.264. Quando necessário, o FFmpeg une as faixas sem transcodificá-las. Arquivos existentes não são sobrescritos.

Os downloads do YouTube são arquivos MP4 com áudio AAC. O vídeo usa AVC/H.264 sempre que o site oferece; alturas que só existem em VP9 ou AV1 (no YouTube, 1440p e 4K) são marcadas com **pode exigir VLC**. O contêiner MP4, por si só, não garante que o QuickTime ou o player padrão do sistema reproduzam VP9 ou AV1; nesse caso, use o VLC ou o IINA. Se a qualidade escolhida deixar de estar disponível entre a prévia e o download, o Clipora pede que você atualize a prévia e escolha outra. Depois de concluir, **Baixar novamente** na tela de conclusão preserva a escolha enquanto você continua nessa prévia. O histórico não guarda a qualidade: ao colar o link de novo e carregar uma nova prévia, a seleção volta para **Melhor compatível**.

O Clipora aceita vídeos normais do YouTube. Shorts, transmissões ao vivo, Stories e playlists inteiras não são suportados. Links que exigem login, são privados ou estão indisponíveis não podem ser baixados por esse fluxo.

No Instagram e TikTok, o nome do arquivo combina o perfil, o início da descrição (ou o título disponível) e o ID do vídeo, por exemplo: `@perfil - Como preparar café gelado [ID].mp4`. No YouTube, usa o título do vídeo e o ID; se o título não estiver disponível, usa o nome do canal e depois `Vídeo [ID]`. O Clipora ajusta caracteres incompatíveis e encurta textos longos. Downloads repetidos recebem um número, como ` (2)`, preservando o arquivo anterior.

## Cancelar um download

Durante o download, selecione **Cancelar download**. O Clipora mostra **Cancelando…** enquanto encerra os processos e remove os arquivos parciais daquela tentativa. Aguarde a confirmação **Download cancelado.** para começar outro download.

O link, a prévia e a qualidade escolhida permanecem disponíveis para tentar novamente. A nova tentativa começa do zero. Downloads cancelados não aparecem como concluídos no histórico, e os vídeos já salvos são preservados.

Se o arquivo já estiver sendo salvo na etapa final quando o pedido chegar, o Clipora pode confirmar **Download concluído**. Nesse caso, o vídeo permanece na pasta de destino.

## Histórico e links repetidos

Quando o download termina, o Clipora guarda um registro no histórico local. A lista fica no próprio dispositivo e mostra os downloads concluídos, do mais recente ao mais antigo. Use **Abrir vídeo** na conclusão ou no histórico para abrir o arquivo no aplicativo padrão do sistema. O histórico também permite revelar o vídeo na pasta onde foi salvo.

Se o vídeo tiver sido movido, removido ou estiver inacessível, o registro continua na lista e o Clipora informa que o arquivo não está disponível. Você pode tentar baixar o vídeo novamente. O app não procura automaticamente por arquivos movidos em outras pastas.

Ao colar um link de um vídeo que já aparece no histórico, o Clipora mostra um aviso. Se a cópia ainda estiver disponível, você pode abri-la; também pode escolher **Baixar** para fazer outra cópia. O aviso não impede um novo download. Links curtos podem não ser reconhecidos como repetidos quando o Clipora não consegue relacioná-los ao mesmo vídeo.

No YouTube, a escolha de qualidade não altera o aviso de link repetido: você pode abrir a cópia disponível ou baixar outra. O histórico não registra a qualidade usada; ao colar o link novamente, uma nova prévia começa em **Melhor compatível**.

O histórico começa vazio. O Clipora não importa downloads antigos nem examina a pasta de destino para preencher a lista. Para limpar o histórico, confirme a ação apresentada no app. Isso apaga somente os registros da lista; os arquivos de vídeo continuam nas pastas onde foram salvos.

Os registros do histórico — incluindo links, títulos, datas e caminhos dos arquivos — são guardados localmente no dispositivo e não são enviados pelo Clipora. Isso não altera o funcionamento do download: para obter a prévia ou o vídeo, o app acessa o serviço indicado pelo link.

## Atualizar o yt-dlp

O Clipora verifica a versão do yt-dlp e exibe um aviso quando encontra uma atualização. A atualização só começa depois que você a solicita na área de configurações. Ela é baixada da release oficial do yt-dlp e verificada por assinatura GPG e SHA-256 antes de ser ativada. O arquivo fica no diretório de dados do usuário, fora do pacote do Clipora, para não alterar o aplicativo assinado. A versão anterior e a versão embutida continuam disponíveis como recuperação.

Antes de ativar uma versão candidata, o Clipora também verifica localmente se ela funciona com o runtime usado pelo YouTube. Se não conseguir verificar essa compatibilidade, recusa a atualização e preserva a versão anterior. O runtime Deno necessário ao YouTube já vem no app; você não precisa instalá-lo à parte.

Não atualize o yt-dlp baixando outro executável por fora nem use a opção de autoatualização do próprio yt-dlp. Para consultar os avisos e as fontes dos componentes, abra **Sobre e licenças** dentro do app.

## Limitações conhecidas

- Só há suporte planejado para um vídeo público por vez; conteúdo privado e login não são suportados.
- Serviços podem exigir login, limitar requisições, remover publicações ou mudar seu funcionamento. Um link público pode falhar ou deixar de funcionar.
- A qualidade depende do que o serviço e o yt-dlp disponibilizam; ela não é necessariamente a qualidade original.
- A atualização manual pode ser bloqueada por políticas corporativas ou recursos de segurança do sistema, sobretudo quando o executável atualizado não tem assinatura de código própria.
- Compatibilidade de pacote só é confirmada depois de instalar e executar no sistema e arquitetura correspondentes. Veja os resultados e pendências em [distribuicao.md](../distribuicao.md).

## Relatar um problema

Ao relatar, informe:

- sistema, versão e arquitetura (por exemplo, macOS 14 arm64 ou Windows 11 x64);
- versão do Clipora, formato do pacote e, se souber, versão do yt-dlp indicada em **Sobre e licenças**;
- etapa em que ocorreu (prévia, download, pasta, atualização ou instalação) e a mensagem exibida;
- se o problema se repete e os passos para reproduzi-lo.

Remova tokens, cookies, nomes pessoais e caminhos privados antes de compartilhar logs. Não envie links para conteúdo privado nem arquivos de vídeo. A hospedagem e o canal de suporte ainda serão definidos; até lá, reporte pelo canal de contato indicado junto ao pacote que você recebeu.
