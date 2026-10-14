"""Leva as entradas pendentes da planilha (via Apps Script) para o vault do Obsidian.

Ordem (SPEC 8.2): escrever todas as notas primeiro e só depois marcar como
processado. Se o processo cair no meio, as entradas voltam como pendentes e o
marcador <!-- id:UUID --> evita a duplicata. O inverso perderia dados.

Uso: python sheet_to_obsidian.py
Código de saída: 0 = ok (inclusive sem pendentes), 1 = erro.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

import nota

AQUI = Path(__file__).resolve().parent
LOGS = AQUI / "logs"
ESTADO = AQUI / "state"
TRAVA = ESTADO / "sync.lock"
TRAVA_VELHA_SEG = 30 * 60

log = logging.getLogger("diario-voz")


# ---------- configuração ----------

def configurar_log() -> None:
    LOGS.mkdir(exist_ok=True)
    arquivo = LOGS / f"{datetime.now():%Y-%m}.log"
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    h = logging.FileHandler(arquivo, encoding="utf-8")
    h.setFormatter(fmt)
    log.addHandler(h)
    if sys.stdout is not None:  # pythonw não tem console
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
        c = logging.StreamHandler(sys.stdout)
        c.setFormatter(fmt)
        log.addHandler(c)
    log.setLevel(logging.INFO)


def ler_config() -> dict:
    load_dotenv(AQUI / ".env")
    cfg = {
        "url": os.getenv("APPS_SCRIPT_URL", "").strip(),
        "token": os.getenv("APP_TOKEN", "").strip(),
        "vault": os.getenv("VAULT_PATH", "").strip(),
        "pasta": os.getenv("PASTA_DIARIO", "60-Pessoal/diario").strip().strip("/\\"),
        "sync_script": os.getenv("SYNC_SCRIPT", "").strip(),
        "tarefas": os.getenv("TAREFAS_FORMATO", "tasks").strip().lower(),
    }
    faltando = [k for k, v in (("APPS_SCRIPT_URL", cfg["url"]), ("APP_TOKEN", cfg["token"]),
                               ("VAULT_PATH", cfg["vault"])) if not v]
    if faltando:
        raise SystemExit(f"Faltam variáveis no sync/.env: {', '.join(faltando)}")
    if not Path(cfg["vault"]).is_dir():
        raise SystemExit(f"VAULT_PATH não é uma pasta existente: {cfg['vault']}")
    if cfg["tarefas"] not in ("tasks", "simples"):
        raise SystemExit("TAREFAS_FORMATO deve ser 'tasks' ou 'simples'.")
    return cfg


# ---------- trava (logon e tarefa de 2 h podem coincidir) ----------

def pegar_trava() -> bool:
    ESTADO.mkdir(exist_ok=True)
    try:
        if TRAVA.exists() and time.time() - TRAVA.stat().st_mtime > TRAVA_VELHA_SEG:
            TRAVA.unlink()
        fd = os.open(TRAVA, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False


def soltar_trava() -> None:
    try:
        TRAVA.unlink()
    except FileNotFoundError:
        pass


# ---------- Apps Script ----------

class ErroServidor(Exception):
    pass


def chamar(cfg: dict, acao: str, **dados) -> dict:
    """POST text/plain com até 3 tentativas (o Wi-Fi pode demorar após o logon)."""
    corpo = json.dumps({**dados, "acao": acao, "token": cfg["token"]}, ensure_ascii=False).encode("utf-8")
    esperas = [5, 20, 60]
    for tentativa in range(len(esperas) + 1):
        try:
            r = requests.post(cfg["url"], data=corpo, timeout=60,
                              headers={"Content-Type": "text/plain;charset=utf-8"})
            r.raise_for_status()
            try:
                j = r.json()
            except ValueError:
                raise ErroServidor("resposta não é JSON (a URL termina em /exec?)")
            if not j.get("ok"):
                raise ErroServidor(f"{j.get('erro')}: {j.get('msg')}")
            return j
        except (requests.ConnectionError, requests.Timeout) as e:
            if tentativa == len(esperas):
                raise ErroServidor(f"sem conexão após {tentativa + 1} tentativas ({type(e).__name__})")
            log.warning("sem conexão (%s); nova tentativa em %ss", type(e).__name__, esperas[tentativa])
            time.sleep(esperas[tentativa])
        except requests.HTTPError as e:
            raise ErroServidor(f"HTTP {e.response.status_code}")
    raise AssertionError("inalcançável")


# ---------- arquivos ----------

def ler_nota(caminho: Path) -> tuple[str | None, str]:
    """(conteúdo com \\n, quebra de linha original)."""
    if not caminho.exists():
        return None, "\n"
    bruto = caminho.read_bytes().decode("utf-8-sig")
    quebra = "\r\n" if "\r\n" in bruto else "\n"
    return bruto.replace("\r\n", "\n"), quebra


def gravar_atomico(caminho: Path, conteudo: str, quebra: str) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_name(caminho.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(conteudo.replace("\n", quebra))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, caminho)


# ---------- fluxo ----------

def sincronizar(cfg: dict) -> int:
    pendentes = chamar(cfg, "pendentes")["entradas"]
    if not pendentes:
        log.info("nenhuma entrada pendente")
        return 0
    log.info("%d entradas pendentes", len(pendentes))

    base = Path(cfg["vault"]) / cfg["pasta"]
    prontos: list[str] = []
    for dia, entradas in nota.agrupar_por_dia(pendentes).items():
        caminho = base / nota.caminho_relativo(dia)
        atual, quebra = ler_nota(caminho)
        novo, escritos = nota.atualizar_nota(atual, dia, entradas, cfg["tarefas"])
        if escritos:
            gravar_atomico(caminho, novo, quebra)
            log.info("%s: %d novas, %d já estavam na nota", caminho.relative_to(base),
                     len(escritos), len(entradas) - len(escritos))
        else:
            log.info("%s: todas as %d já estavam na nota", caminho.relative_to(base), len(entradas))
        prontos.extend(e["id"] for e in entradas)

    # Só depois de TODOS os arquivos gravados. Em lotes, pelo limite de 20 KB do servidor.
    marcados = 0
    for i in range(0, len(prontos), 300):
        marcados += chamar(cfg, "marcar", ids=prontos[i:i + 300]).get("marcados", 0)
    log.info("marcadas como processado: %d", marcados)

    if cfg["sync_script"]:
        rodar_sync_script(cfg["sync_script"])
    return 0


def rodar_sync_script(caminho: str) -> None:
    if not Path(caminho).is_file():
        log.warning("SYNC_SCRIPT não encontrado: %s", caminho)
        return
    try:
        p = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", caminho],
            capture_output=True, text=True, timeout=600,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if p.returncode == 0:
            log.info("SYNC_SCRIPT ok")
        else:
            log.warning("SYNC_SCRIPT saiu com %s: %s", p.returncode, (p.stderr or p.stdout)[-500:].strip())
    except subprocess.TimeoutExpired:
        log.warning("SYNC_SCRIPT passou de 10 minutos e foi interrompido")


def main() -> int:
    configurar_log()
    try:
        cfg = ler_config()
    except SystemExit as e:
        log.error("%s", e)
        return 1
    if not pegar_trava():
        log.info("outra execução em andamento; saindo")
        return 0
    try:
        return sincronizar(cfg)
    except ErroServidor as e:
        log.error("servidor: %s", e)
        return 1
    except Exception:
        log.exception("erro inesperado")
        return 1
    finally:
        soltar_trava()


if __name__ == "__main__":
    sys.exit(main())
