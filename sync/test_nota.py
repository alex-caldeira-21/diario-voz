from datetime import date

import nota

DIA = date(2026, 10, 14)


def entrada(id_, criado_em, texto, tipo="trabalho", tags=None, lembrete_data=None):
    return {"id": id_, "criado_em": criado_em, "texto": texto, "tipo": tipo,
            "tags": tags or [], "lembrete_data": lembrete_data}


E1 = entrada("id-0832", "2026-10-14T08:32:10-03:00",
             "Nobreak do POP Pederneiras com alarme de bateria, agendar troca.",
             tags=["pop-pederneiras", "nobreak"])
E2 = entrada("id-1500", "2026-10-14T15:00:00-03:00", "Fechei o relatório da preventiva.",
             tags=["preventiva"])


def secao(texto, titulo):
    """Corpo de uma seção, até a próxima '## '."""
    ini = texto.index(titulo + "\n") + len(titulo) + 1
    prox = texto.find("\n## ", ini)
    return texto[ini:] if prox == -1 else texto[ini:prox]


# ---------- nota nova ----------

def test_nota_nova_tem_frontmatter_titulo_e_entrada():
    texto, ids = nota.atualizar_nota(None, DIA, [E1])
    assert ids == ["id-0832"]
    assert texto.startswith("---\ntipo: diario\ndata: 2026-10-14\n")
    assert "tags: [diario, pop-pederneiras, nobreak]" in texto
    assert "# Quarta, 14 de outubro de 2026" in texto
    assert ("### 08:32 (trabalho)\n<!-- id:id-0832 -->\n"
            "Nobreak do POP Pederneiras com alarme de bateria, agendar troca.\n"
            "#pop-pederneiras #nobreak") in texto
    assert "## Lembretes" not in texto  # só aparece quando há lembrete com data


def test_texto_literal_multilinha_e_caracteres_especiais():
    e = entrada("id-x", "2026-10-14T09:00:00-03:00", "Linha 1 *não* é negrito\n  - item com espaço\n= sinal")
    texto, _ = nota.atualizar_nota(None, DIA, [e])
    assert "Linha 1 *não* é negrito\n  - item com espaço\n= sinal" in texto


# ---------- nota existente com conteúdo manual ----------

MANUAL = """---
tipo: diario
humor: bom
tags:
  - diario
  - viagem
---

# Meu dia

Texto que escrevi à mão no Obsidian.

## Entradas

Comentário manual no topo das entradas.

### 07:00 (pessoal)
<!-- id:id-0700 -->
Café com a família.

## Notas soltas

- [[link interno]]
"""


def test_existente_preserva_conteudo_manual():
    texto, ids = nota.atualizar_nota(MANUAL, DIA, [E1])
    assert ids == ["id-0832"]
    for trecho in ["humor: bom", "# Meu dia", "Texto que escrevi à mão no Obsidian.",
                   "Comentário manual no topo das entradas.", "Café com a família.",
                   "## Notas soltas", "- [[link interno]]"]:
        assert trecho in texto
    # tags unidas, sem repetição, com diario sempre presente
    assert "tags: [diario, viagem, pop-pederneiras, nobreak]" in texto
    corpo = secao(texto, "## Entradas")
    assert corpo.index("Comentário manual") < corpo.index("id-0700") < corpo.index("id-0832")
    assert "## Notas soltas" in texto.split("id-0832")[1]  # nova entrada ficou dentro da seção


def test_secao_inexistente_e_criada_no_final():
    manual = "# Rascunho\n\nSó texto meu.\n"
    texto, _ = nota.atualizar_nota(manual, DIA, [E1])
    assert texto.index("Só texto meu.") < texto.index("## Entradas") < texto.index("id-0832")
    assert texto.startswith("---\n")  # frontmatter acrescentado com as tags
    assert "Só texto meu." in texto


# ---------- id repetido ----------

def test_id_repetido_nao_duplica_e_nao_altera_arquivo():
    primeira, _ = nota.atualizar_nota(None, DIA, [E1])
    segunda, ids = nota.atualizar_nota(primeira, DIA, [E1])
    assert ids == []
    assert segunda == primeira
    assert segunda.count("<!-- id:id-0832 -->") == 1


def test_rodar_duas_vezes_com_lote_misto():
    primeira, _ = nota.atualizar_nota(None, DIA, [E1])
    segunda, ids = nota.atualizar_nota(primeira, DIA, [E1, E2])
    assert ids == ["id-1500"]
    assert segunda.count("id-0832") == 1 and segunda.count("id-1500") == 1


# ---------- lembretes ----------

def test_lembrete_com_data_vira_tarefa_tasks():
    e = entrada("id-lem", "2026-10-14T10:00:00-03:00",
                "Agendar troca de bateria do nobreak Pederneiras", tipo="lembrete",
                tags=["nobreak"], lembrete_data="2026-10-17")
    texto, _ = nota.atualizar_nota(None, DIA, [e])
    assert "### 10:00 (lembrete)" in texto
    assert secao(texto, "## Lembretes").strip() == \
        "- [ ] Agendar troca de bateria do nobreak Pederneiras 📅 2026-10-17"


def test_lembrete_formato_simples():
    e = entrada("id-lem", "2026-10-14T10:00:00-03:00", "Ligar para o cliente",
                tipo="lembrete", lembrete_data="2026-10-17")
    texto, _ = nota.atualizar_nota(None, DIA, [e], formato_tarefas="simples")
    assert "- [ ] Ligar para o cliente (até 17/10)" in texto


def test_lembrete_sem_data_nao_vira_tarefa():
    e = entrada("id-lem", "2026-10-14T10:00:00-03:00", "Lembrar de estudar BGP",
                tipo="lembrete", lembrete_data=None)
    texto, ids = nota.atualizar_nota(None, DIA, [e])
    assert ids == ["id-lem"]
    assert "Lembrar de estudar BGP" in texto
    assert "## Lembretes" not in texto and "- [ ]" not in texto


def test_tarefas_acrescentadas_em_secao_existente():
    a = entrada("a", "2026-10-14T10:00:00-03:00", "Primeira", tipo="lembrete", lembrete_data="2026-10-20")
    b = entrada("b", "2026-10-14T11:00:00-03:00", "Segunda", tipo="lembrete", lembrete_data="2026-10-21")
    t1, _ = nota.atualizar_nota(None, DIA, [a])
    t2, _ = nota.atualizar_nota(t1, DIA, [b])
    assert secao(t2, "## Lembretes").strip().split("\n") == [
        "- [ ] Primeira 📅 2026-10-20", "- [ ] Segunda 📅 2026-10-21"]


# ---------- ordem cronológica com entrada offline ----------

def test_entrada_offline_antiga_entra_na_posicao_certa():
    t1, _ = nota.atualizar_nota(None, DIA, [E1, E2])  # 08:32 e 15:00 já na nota
    offline = entrada("id-1000", "2026-10-14T10:00:00-03:00", "Gravada offline no POP, enviada às 15h.")
    t2, ids = nota.atualizar_nota(t1, DIA, [offline])
    assert ids == ["id-1000"]
    corpo = secao(t2, "## Entradas")
    assert corpo.index("id-0832") < corpo.index("id-1000") < corpo.index("id-1500")


def test_lote_fora_de_ordem_e_ordenado():
    texto, _ = nota.atualizar_nota(None, DIA, [E2, E1])
    assert texto.index("id-0832") < texto.index("id-1500")


# ---------- agrupamento por dia no fuso de São Paulo ----------

def test_agrupa_pelo_dia_de_sao_paulo():
    noite = entrada("n", "2026-10-15T01:30:00+00:00", "UTC já é dia 15, em SP ainda é 14")
    manha = entrada("m", "2026-10-15T08:00:00-03:00", "Dia 15")
    grupos = nota.agrupar_por_dia([manha, noite])
    assert list(grupos) == [date(2026, 10, 14), date(2026, 10, 15)]
    texto, _ = nota.atualizar_nota(None, date(2026, 10, 14), grupos[date(2026, 10, 14)])
    assert "### 22:30 (trabalho)" in texto


def test_caminho_relativo():
    assert nota.caminho_relativo(DIA) == "2026/2026-10-14.md"
