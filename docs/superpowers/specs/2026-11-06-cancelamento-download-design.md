# Cancelamento de download — desenho aprovado

Aprovado pelo usuário em 2026-11-06 após a proposta de cancelar, descartar parciais e preservar prévia/qualidade para tentar novamente. Escopo: YouTube, Instagram e TikTok; implementação comum aos sistemas já suportados. Compatibilidade de codecs fica fora desta entrega.

## Comportamento

- Botão **Cancelar download** junto ao progresso; cancelamento direto, sem confirmação (decisão de implementação do Timoneiro para uma tentativa recuperável).
- Após o clique: **Cancelando…**, botão desabilitado e bloqueio de novo download até receber resultado terminal e terminar a limpeza.
- Cancelamento encerra processos/descendentes da tentativa, descarta somente temporários próprios e não registra sucesso no histórico.
- Resultado **Download cancelado.**; preservar link, prévia e qualidade quando disponíveis. Próxima tentativa começa do zero. Sem retomada/pausa.
- Suportar preparação, transferência de vídeo/áudio, união e validação. Finalização tem um limite protegido: cancelamento aceito antes da promoção impede arquivo final; se a promoção já começou/terminou, a conclusão vence e o arquivo permanece.
- Uma única conclusão terminal por tentativa. IDs antigos, cliques repetidos e eventos atrasados não afetam nova tentativa.
- Recarga da janela recupera estado de cancelamento e resultado terminal por obter_estado, sem depender do canal original.
- Ao cancelar antes de iniciar_download responder, aguardar o aceite/resultado dessa chamada e cancelar a tentativa correta. Se o seletor de pasta estiver aberto, impedir a retentativa depois que ele fechar. Cancelar não causa uma retentativa automática.

## Abordagens

Reutilizar encerrar() diretamente foi descartado: ele marca o aplicativo como encerrando e aborta o fluxo sem publicar resultado de cancelamento. A abordagem escolhida é sinal de cancelamento por tentativa, com encerramento/limpeza e publicação terminal centralizada. Pausa/retomada exigiria persistência e regras de continuação, fora do pedido aprovado.

## Contrato fixo

- Comando e serviço: cancelar_download({ downloadId: string }): Promise<void>. É pedido idempotente; somente eventos/estado terminal confirmam o resultado. ID ausente, encerrado ou diferente do ativo é no-op e nunca cancela outro download. Falhas reais de comunicação/controle são reportadas pela chamada.
- EventoDownload ganha { tipo: 'cancelado' }.
- ResultadoTerminal ganha { tipo: 'cancelado'; downloadId: string; alturaYoutube: number | null }.
- EstadoDownload ganha cancelando: boolean (consumidores toleram ausência como false).
- obter_estado mantém o download ativo até encerramento/limpeza; depois publica ultimoResultado cancelado ou concluido conforme o limite acima.
- Cancelamento é resultado normal, não código de erro de rede/download. Mensagem de cancelamento não aparece na tela vermelha de erro.

## Verificação

Testes determinísticos com processos de fixture cobrem etapas, descendentes, temporários, histórico, repetição, IDs antigos, corrida com promoção e novo download. Testes de UI cobrem clique/teclado, pendência, falha do pedido, canal/polling, início pendente e seletor de pasta. Aceitação com sidecars reais usa arquivos próprios em diretório temporário. Build final macOS arm64 é isolado e conferido. Janela nativa e Windows/Linux/Intel só serão declarados verificados se efetivamente testados. Não encerrar app/download do usuário, não fazer push/publicação.
