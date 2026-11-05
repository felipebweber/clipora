# Guia do Clipora

O Clipora baixa um vídeo público por vez de links compatíveis do Instagram Reels e do TikTok. O vídeo é processado no seu computador.

## Instalação

Instale o pacote publicado para seu sistema e arquitetura: Windows x64/arm64 (`.exe` NSIS; MSI x64 opcional), macOS (`.dmg`) ou Linux (AppImage, `.deb` ou `.rpm`, conforme a release). Use apenas os downloads e hashes publicados pelo projeto. O projeto ainda não tem página de releases pública; o primeiro CI ainda não foi executado, e a compatibilidade real de cada sistema depende de testes nesse sistema.

- **Windows**: abra o instalador e siga as etapas. Sem assinatura Authenticode, o Windows pode mostrar avisos do SmartScreen; o Smart App Control pode impedir a execução.
- **macOS**: abra o `.dmg` e arraste Clipora para Aplicativos. Uma release sem assinatura Developer ID e notarização pode ser bloqueada pelo Gatekeeper. Não há conta nem certificado configurados neste momento.
- **Linux**: use o formato disponível para sua distribuição e arquitetura. O sistema precisa dos componentes WebKitGTK compatíveis com o pacote; consulte os pré-requisitos do pacote da release.

Não instale um pacote cujo hash publicado não confira. Não há atualização automática do próprio Clipora nesta versão.

## Baixar um vídeo

1. Cole o link de um vídeo público do Instagram Reels ou TikTok no campo principal. O Clipora carrega a prévia quando o yt-dlp consegue acessar o link.
2. Confira a prévia e selecione **Baixar**.
3. Na primeira vez, escolha uma pasta de destino. O Clipora guarda essa preferência localmente. Altere-a em **Configurações** quando precisar.
4. Acompanhe o progresso. Ao concluir, use **Abrir pasta** para localizar o arquivo.

O Clipora salva um vídeo por vez e escolhe a melhor combinação de vídeo e áudio que o yt-dlp consegue obter. Quando necessário, o FFmpeg une as faixas sem transcodificá-las. Arquivos existentes não são sobrescritos.

## Atualizar o yt-dlp

O Clipora verifica a versão do yt-dlp e exibe um aviso quando encontra uma atualização. A atualização só começa depois que você a solicita na área de configurações. Ela é baixada da release oficial do yt-dlp e verificada por assinatura GPG e SHA-256 antes de ser ativada. O arquivo fica no diretório de dados do usuário, fora do pacote do Clipora, para não alterar o aplicativo assinado. A versão anterior e a versão embutida continuam disponíveis como recuperação.

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
