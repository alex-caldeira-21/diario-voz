"""Formatação das notas diárias do Obsidian. Funções puras, sem I/O.

Regras (SPEC 8.3):
- cada entrada leva o marcador <!-- id:UUID -->; id já presente no arquivo é pulado;
- entradas em ordem cronológica dentro de "## Entradas", mesmo quando uma
  entrada antiga (gravada offline) chega depois;
- lembretes com data também viram tarefa em "## Lembretes";
- conteúdo manual da nota é preservado; seção que não existe é criada no final;
- o texto ditado é escrito literalmente.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")

DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]

SECAO_ENTRADAS = "## Entradas"
SECAO_LEMBRETES = "## Lembretes"

RE_HORA_BLOCO = re.compile(r"^### (\d{2}:\d{2})\b")
RE_SECAO = re.compile(r"^## \S")


# ---------- datas ----------

def momento_local(criado_em: str) -> datetime:
    """ISO 8601 com offset -> datetime no fuso de São Paulo."""
    dt = datetime.fromisoformat(criado_em.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=FUSO)
    return dt.astimezone(FUSO)


def dia_local(criado_em: str) -> date:
    return momento_local(criado_em).date()


def titulo_do_dia(d: date) -> str:
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def agrupar_por_dia(entradas: list[dict]) -> dict[date, list[dict]]:
    grupos: dict[date, list[dict]] = {}
    for e in entradas:
        grupos.setdefault(dia_local(e["criado_em"]), []).append(e)
    for lista in grupos.values():
        lista.sort(key=lambda e: momento_local(e["criado_em"]))
    return dict(sorted(grupos.items()))


def caminho_relativo(d: date) -> str:
    """{AAAA}/{AAAA-MM-DD}.md, relativo à pasta do diário."""
    return f"{d.year}/{d.isoformat()}.md"


# ---------- blocos ----------

def _tags(e: dict) -> list[str]:
    t = e.get("tags") or []
    if isinstance(t, str):
        t = [x.strip() for x in t.split(",")]
    return [x for x in t if x]


def marcador(id_: str) -> str:
    return f"<!-- id:{id_} -->"


def bloco_entrada(e: dict) -> str:
    hora = momento_local(e["criado_em"]).strftime("%H:%M")
    linhas = [f"### {hora} ({e.get('tipo') or 'registro'})", marcador(e["id"]), e["texto"]]
    tags = _tags(e)
    if tags:
        linhas.append(" ".join("#" + t for t in tags))
    return "\n".join(linhas)


def linha_tarefa(e: dict, formato: str) -> str | None:
    """Tarefa para lembretes com data. O texto vai literal; só as quebras de
    linha viram espaço, porque uma tarefa do Markdown ocupa uma linha."""
    data = e.get("lembrete_data")
    if e.get("tipo") != "lembrete" or not data:
        return None
    texto = " ".join(e["texto"].split("\n")).strip()
    if formato == "simples":
        a, m, d = data.split("-")
        return f"- [ ] {texto} (até {d}/{m})"
    return f"- [ ] {texto} 📅 {data}"


# ---------- frontmatter ----------

def _separar_frontmatter(conteudo: str) -> tuple[list[str] | None, str]:
    if conteudo.startswith("---\n"):
        fim = conteudo.find("\n---\n", 4)
        if fim == -1 and conteudo.endswith("\n---"):
            fim = len(conteudo) - 4
        if fim != -1:
            fm = conteudo[4:fim].split("\n") if fim > 4 else []
            resto = conteudo[fim + 5:] if fim + 5 <= len(conteudo) else ""
            return fm, resto
    return None, conteudo


def _ler_tags_fm(fm: list[str]) -> tuple[list[str], int, int]:
    """Retorna (tags, início, fim) das linhas da chave tags; (.., -1, -1) se ausente."""
    for i, linha in enumerate(fm):
        m = re.match(r"^tags:\s*(.*)$", linha)
        if not m:
            continue
        valor = m.group(1).strip()
        if valor.startswith("["):
            itens = [x.strip().strip("'\"") for x in valor.strip("[]").split(",")]
            return [x for x in itens if x], i, i + 1
        if valor:
            return [x.strip().strip("'\"") for x in valor.split(",") if x.strip()], i, i + 1
        j = i + 1
        itens = []
        while j < len(fm) and re.match(r"^\s*-\s+", fm[j]):
            itens.append(re.sub(r"^\s*-\s+", "", fm[j]).strip().strip("'\""))
            j += 1
        return itens, i, j
    return [], -1, -1


def _uniao(*listas: list[str]) -> list[str]:
    vistos, saida = set(), []
    for lista in listas:
        for t in lista:
            if t and t not in vistos:
                vistos.add(t)
                saida.append(t)
    return saida


def _aplicar_frontmatter(conteudo: str, d: date, novas_tags: list[str]) -> str:
    fm, resto = _separar_frontmatter(conteudo)
    if fm is None:
        fm = ["tipo: diario", f"data: {d.isoformat()}"]
        resto = conteudo
    tags, ini, fim = _ler_tags_fm(fm)
    linha = f"tags: [{', '.join(_uniao(['diario'], tags, novas_tags))}]"
    if ini == -1:
        fm = fm + [linha]
    else:
        fm = fm[:ini] + [linha] + fm[fim:]
    return "---\n" + "\n".join(fm) + "\n---\n" + resto


# ---------- seções ----------

def _localizar_secao(linhas: list[str], titulo: str) -> tuple[int, int]:
    """(índice do título, índice onde a seção termina) ou (-1, -1)."""
    for i, l in enumerate(linhas):
        if l.rstrip() == titulo:
            j = i + 1
            while j < len(linhas) and not RE_SECAO.match(linhas[j]):
                j += 1
            return i, j
    return -1, -1


def _garantir_secao(linhas: list[str], titulo: str) -> list[str]:
    if _localizar_secao(linhas, titulo)[0] != -1:
        return linhas
    while linhas and linhas[-1].strip() == "":
        linhas = linhas[:-1]
    return linhas + ["", titulo, ""]


def _inserir_entradas(corpo: list[str], novas: list[dict]) -> list[str]:
    """Insere blocos novos entre os existentes respeitando a hora."""
    # Separa preâmbulo (texto manual antes do primeiro ###) e blocos.
    pre, blocos, atual = [], [], None
    for l in corpo:
        if l.startswith("### "):
            atual = [l]
            blocos.append(atual)
        elif atual is None:
            pre.append(l)
        else:
            atual.append(l)

    # Chave de ordenação de cada bloco existente; blocos sem hora herdam a anterior.
    itens, ultima = [], "00:00"
    for b in blocos:
        m = RE_HORA_BLOCO.match(b[0])
        if m:
            ultima = m.group(1)
        texto = "\n".join(b).strip("\n")
        itens.append((ultima, texto))

    for e in sorted(novas, key=lambda x: momento_local(x["criado_em"])):
        chave = momento_local(e["criado_em"]).strftime("%H:%M")
        pos = len(itens)
        while pos > 0 and itens[pos - 1][0] > chave:
            pos -= 1
        itens.insert(pos, (chave, bloco_entrada(e)))

    while pre and pre[-1].strip() == "":
        pre.pop()
    while pre and pre[0].strip() == "":
        pre.pop(0)
    partes = ["\n".join(pre)] if any(x.strip() for x in pre) else []
    partes += [t for _, t in itens]
    return ("\n\n".join(partes)).split("\n") + [""]


def _inserir_tarefas(corpo: list[str], tarefas: list[str]) -> list[str]:
    while corpo and corpo[-1].strip() == "":
        corpo = corpo[:-1]
    while corpo and corpo[0].strip() == "":
        corpo = corpo[1:]
    return corpo + tarefas + [""]


def _substituir_corpo(linhas: list[str], titulo: str, novo_corpo: list[str]) -> list[str]:
    i, j = _localizar_secao(linhas, titulo)
    return linhas[:i + 1] + [""] + novo_corpo + linhas[j:]


# ---------- API principal ----------

def nota_nova(d: date) -> str:
    return (
        "---\n"
        "tipo: diario\n"
        f"data: {d.isoformat()}\n"
        "tags: [diario]\n"
        "---\n"
        "\n"
        f"# {titulo_do_dia(d)}\n"
        "\n"
        f"{SECAO_ENTRADAS}\n"
    )


def atualizar_nota(conteudo: str | None, d: date, entradas: list[dict],
                   formato_tarefas: str = "tasks") -> tuple[str, list[str]]:
    """Insere na nota do dia as entradas cujo id ainda não está nela.

    Retorna (conteúdo novo, ids escritos agora). Se nada for novo, o conteúdo
    volta idêntico ao recebido.
    """
    original = conteudo
    if conteudo is None:
        conteudo = nota_nova(d)

    novas = [e for e in entradas if marcador(e["id"]) not in conteudo]
    if not novas:
        return (original if original is not None else conteudo), []

    linhas = conteudo.split("\n")
    linhas = _garantir_secao(linhas, SECAO_ENTRADAS)
    i, j = _localizar_secao(linhas, SECAO_ENTRADAS)
    linhas = _substituir_corpo(linhas, SECAO_ENTRADAS, _inserir_entradas(linhas[i + 1:j], novas))

    tarefas = [t for t in (linha_tarefa(e, formato_tarefas) for e in sorted(novas, key=lambda x: momento_local(x["criado_em"]))) if t]
    if tarefas:
        linhas = _garantir_secao(linhas, SECAO_LEMBRETES)
        i, j = _localizar_secao(linhas, SECAO_LEMBRETES)
        linhas = _substituir_corpo(linhas, SECAO_LEMBRETES, _inserir_tarefas(linhas[i + 1:j], tarefas))

    texto = "\n".join(linhas).rstrip("\n") + "\n"

    novas_tags = [t for e in novas for t in _tags(e)]
    texto = _aplicar_frontmatter(texto, d, novas_tags)
    return texto, [e["id"] for e in novas]
