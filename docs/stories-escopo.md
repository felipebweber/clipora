# Stories por link — escopo e evolução futura

Registro de decisões do usuário em 2026-11-06. O trabalho está em planejamento;
este registro não representa implementação nem comprovação de acesso sem login.
O plano e a especificação originais do MVP permanecem preservados.

## Decisões desta versão

- A entrada é o link de um story específico do Instagram.
- O escopo inclui stories de foto e de vídeo.
- Só atender conteúdo que possa ser obtido sem autenticação.
- Quando o acesso exigir login, informar essa limitação e encerrar a tentativa.
  Não oferecer conexão de conta nesta versão.
- Não importar cookies autenticados, aproveitar sessões de navegadores nem
  solicitar usuário e senha.

## Limite de viabilidade

Perfil público não garante acesso anônimo a seus stories. O extrator atual do
yt-dlp pode retornar exigência de login; seu caminho de stories também filtra
itens sem formatos de vídeo. Liberar a URL no validador não basta para atender
fotos e vídeos.

A próxima etapa técnica proposta é verificar acesso anônimo com links de stories
ativos, incluindo uma foto e um vídeo, em ambiente sem sessão autenticada.
Registrar versão da ferramenta, resultado e momento da tentativa, pois esses
links são temporários. Testes simulados não comprovam acesso real.

Se o acesso anônimo não for viável, registrar o resultado e manter a funcionalidade
pendente; não introduzir autenticação para cumprir a entrega desta versão.
Sem evidência real, não anunciar suporte funcional a stories sem login.

Sondagem executada em 2026-11-06: dois perfis retornaram exigência de login;
um Reel de controle carregou metadados sem autenticação. O link individual enviado
pelo usuário também retornou exigência de login, com e sem os parâmetros de
compartilhamento. Nenhuma foto ou vídeo de story foi baixado; o tipo e a validade
atual desse item não puderam ser confirmados. Ver [resultados e limites do
teste](stories-teste-sem-login.md).

## Proposta de integração ainda a detalhar

Reaproveitar o fluxo de colar link, prévia, baixar e histórico. Salvar a foto como
imagem e o vídeo como vídeo, sem transformar fotos em MP4. A escolha do extrator,
formatos aceitos, validação dos arquivos, evolução do histórico e testes depende
da verificação de viabilidade e do fechamento do desenho.

## Próximo desenvolvimento — autenticação do Instagram

Pedido explícito do usuário: deixar o suporte a login registrado para o próximo
desenvolvimento. Ele está fora desta versão.

Na evolução seguinte, definir a experiência de conectar/desconectar a conta,
o mecanismo de sessão, armazenamento e remoção das credenciais de sessão,
tratamento de sessão expirada e compatibilidade com cada sistema. Usar sessão
do navegador e importar arquivo de cookies são alternativas a avaliar, não uma
escolha já aprovada. Este registro não autoriza acessar uma conta agora.

## Fontes técnicas consultadas em 2026-11-06

- [Extrator de stories do yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py#L648-L706): exigência de login em respostas inacessíveis e seleção de itens com formatos de vídeo.
- [Cookies no yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp): alternativas de sessão para a evolução futura.

As fontes descrevem o código upstream consultado, não garantem o comportamento
da versão empacotada no Clipora nem substituem a validação com stories reais.
