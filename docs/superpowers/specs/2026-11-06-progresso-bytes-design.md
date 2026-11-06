# Progresso por bytes

Aprovado pelo usuário em "faça esse ajuste", após a proposta de calcular pelos bytes de vídeo + áudio e separar a finalização. Base7e3be5a.

A barra mede somente a transferência: soma dos bytes recebidos de cada formato selecionado dividida pela soma de seus tamanhos. Vídeo de2,76GB e áudio de21MB não recebem pesos iguais. Usar tamanhos exatos publicados pelo yt-dlp (filesize e total_bytes); faltar tamanho confiável de qualquer parte deixa percentual null. Retomada/repetição do mesmo formato não soma os bytes duas vezes. 100% significa transferência terminada; unindo/finalizando ficam indeterminados, conclusão só após validação e arquivo salvo.

Abordagens: manter pesos45/45/10 foi descartado por inventar progresso; percentual separado por etapa foi descartado porque perde visão da transferência inteira. Escolha aprovada: soma por bytes com finalização separada. Sem alterar qualidade, velocidade, seleção, updater ou decisões de distribuição.

IPC mantém percentual:number|null, agora percentual da transferência. Sem novos campos obrigatórios. Interface explicita "transferido" e não mostra percentual de processamento. O comando emite um plano limitado dos formatos selecionados em before_dl, sem URLs/cabeçalhos/legendas, e progresso por ID do formato. Teste real deve validar esses registros do yt-dlp empacotado, pois um falso incompleto não prova integração.
