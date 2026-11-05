# Contrato IPC previsto

Rascunho para dados simulados da interface. Nenhum dos comandos ou eventos abaixo está implementado. Nomes e formatos poderão ser ajustados em conjunto antes da integração. Todos os caminhos são strings locais; `null` indica valor ausente. Argumentos de comandos usam camelCase.

## Comandos

| Comando | Argumentos | Retorno |
| --- | --- | --- |
| `obter_previa` | `{ url: string }` | `{ url: string, titulo: string, imagemUrl: string \| null }` |
| `iniciar_download` | `{ url: string }` | `{ downloadId: string }` |
| `obter_pasta_destino` | nenhum | `{ caminho: string \| null }` |
| `selecionar_pasta_destino` | nenhum | `{ caminho: string \| null }` (`null` se cancelado) |
| `abrir_pasta_destino` | nenhum | `null` |
| `verificar_ytdlp` | nenhum | `{ versaoAtual: string, versaoDisponivel: string \| null, atualizacaoDisponivel: boolean }` |
| `atualizar_ytdlp` | nenhum | `null` após conclusão |

A prévia deve ser associada à URL solicitada: o frontend descarta respostas que não correspondam ao campo atual. Apenas um download pode estar ativo. Selecionar pasta cancelada não inicia download. A atualização é explícita e não pode ocorrer durante download.

## Eventos

| Evento | Payload |
| --- | --- |
| `download-progresso` | `{ downloadId: string, percentual: number \| null, etapa: string }` |
| `download-concluido` | `{ downloadId: string, caminho: string }` |
| `download-erro` | `{ downloadId: string, erro: ErroClipora }` |
| `ytdlp-atualizacao-progresso` | `{ percentual: number \| null, etapa: string }` |

Percentuais, quando conhecidos, variam de 0 a 100; `null` significa indeterminado. Conclusão e erro são terminais para o download identificado. A atualização comunica conclusão ou falha pelo retorno do comando.

## Erros

Comandos rejeitam com `ErroClipora = { codigo: string, mensagem: string }`; eventos de erro usam a mesma estrutura. Mensagens são apropriadas para exibição em português.

| Código | Significado |
| --- | --- |
| `LINK_INVALIDO` | URL inválida ou plataforma não suportada. |
| `CONTEUDO_INACESSIVEL` | Vídeo privado, removido, restrito ou inacessível. |
| `REDE_INDISPONIVEL` | Falha de conexão ou acesso à rede. |
| `PREVIA_INDISPONIVEL` | Não foi possível obter metadados. |
| `PASTA_INDISPONIVEL` | Pasta ausente ou sem permissão de escrita. |
| `DOWNLOAD_EM_ANDAMENTO` | Já existe um download ativo. |
| `ATUALIZACAO_EM_ANDAMENTO` | Atualização impede a operação. |
| `YTDLP_INDISPONIVEL` | Executável ausente ou não executável. |
| `FFMPEG_INDISPONIVEL` | FFmpeg necessário não está disponível. |
| `DOWNLOAD_FALHOU` | Falha ao obter ou processar vídeo. |
| `ATUALIZACAO_FALHOU` | Falha na verificação ou atualização do yt-dlp. |
| `ERRO_INTERNO` | Falha inesperada. |
