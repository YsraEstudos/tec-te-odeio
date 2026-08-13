#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tec Concursos -> Fábrica de PDF / CSV
=====================================
Lê o JSON exportado pelo userscript (meu_caderno_tec.json), monta um HTML
limpo e gera:
  - meu_caderno_tec.pdf   (PDF formatado, via WeasyPrint ou pdfkit)
  - meu_caderno_tec.csv   (CSV pronto para importar no Anki)

Uso:
    python gerar_pdf.py                          # usa meu_caderno_tec.json
    python gerar_pdf.py --json arquivo.json
    python gerar_pdf.py --no-csv                 # só o PDF
    python gerar_pdf.py --no-pdf --csv           # só o CSV
"""

import argparse
import base64
import csv
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.55; }
h1 { font-size: 15pt; border-bottom: 2px solid #2c5282; padding-bottom: 4px; color: #2c5282; }
.questao { margin: 14px 0 22px; padding: 12px 16px; border: 1px solid #cbd5e0; border-radius: 6px; page-break-inside: auto; }
.questao .cabecalho { font-size: 9.5pt; color: #4a5568; font-weight: 600; margin-bottom: 6px; }
.questao .enunciado p { margin: 6px 0; }
.questao .enunciado img { max-width: 100%; }
.alternativas { margin: 8px 0 0; border-collapse: collapse; width: 100%; }
.alternativas td { border: none; padding: 3px 6px 3px 0; vertical-align: top; }
.alternativas td.letra { font-weight: 700; color: #2c5282; width: 26px; white-space: nowrap; }
.alternativas p { margin: 0; }
.alternativas img { max-width: 90%; }
table { border-collapse: collapse; width: 100%; margin: 6px 0; }
td, th { border: 1px solid #a0aec0; padding: 4px 6px; font-size: 10pt; }
"""


def ler_json(caminho):
    with open(caminho, "r", encoding="utf-8") as f:
        return json.load(f)


def baixar_imagens(data, pasta="imagens_tec"):
    """Baixa imagens http(s) que ficaram como URL no JSON. Retorna mapa url -> caminho local."""
    os.makedirs(pasta, exist_ok=True)
    mapa = {}
    urls = set()
    for q in data["questoes"]:
        for html in [q.get("enunciado", "")] + [a.get("texto", "") for a in q.get("alternativas", [])]:
            urls.update(re.findall(r'src="(https?://[^"]+)"', html))
    for url in sorted(urls):
        nome = re.sub(r"[^A-Za-z0-9._-]", "_", url.split("/")[-1]) or "img.png"
        destino = os.path.join(pasta, nome)
        if os.path.exists(destino) and os.path.getsize(destino) > 0:
            mapa[url] = destino
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Referer": "https://www.tecconcursos.com.br/"})
            with urllib.request.urlopen(req, timeout=20) as r, open(destino, "wb") as out:
                out.write(r.read())
            mapa[url] = destino
            print(f"  imagem: {url} -> {destino}")
        except Exception as e:
            print(f"  AVISO: falha ao baixar {url} ({e}) — imagem ficará de fora")
    return mapa


def corrigir_imagens(html, mapa):
    def troca(m):
        url = m.group(1)
        if url in mapa:
            return f'src="file:///{Path(mapa[url]).resolve().as_posix()}"'
        return m.group(0)
    return re.sub(r'src="(https?://[^"]+)"', troca, html)


def montar_html(data, mapa):
    partes = [
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'>",
        f"<title>{data.get('titulo', 'Caderno')}</title><style>{CSS}</style></head><body>",
        f"<h1>{data.get('titulo', 'Caderno Tec Concursos')}</h1>",
        f"<p><small>{data.get('coletadas', 0)} questões exportadas em {data.get('data', '')[:10]}</small></p>",
    ]
    for q in data.get("questoes", []):
        titulo = q.get("titulo", "").replace("#", "#&nbsp;", 1)
        partes.append(
            f"<div class='questao'><div class='cabecalho'>Questão {q.get('posicao', '?')} — {titulo}</div>"
        )
        partes.append(f"<div class='enunciado'>{corrigir_imagens(q.get('enunciado', ''), mapa)}</div>")
        if q.get("alternativas"):
            partes.append("<table class='alternativas'>")
            for a in q["alternativas"]:
                partes.append(
                    f"<tr><td class='letra'>{a.get('letra', '')}</td>"
                    f"<td>{corrigir_imagens(a.get('texto', ''), mapa)}</td></tr>"
                )
            partes.append("</table>")
        partes.append("</div>")
    partes.append("</body></html>")
    return "".join(partes)


def gerar_pdf(html, saida):
    try:
        from weasyprint import HTML
        HTML(string=html).write_pdf(saida)
        print(f"PDF gerado (WeasyPrint): {saida}")
        return True
    except (ImportError, OSError):
        pass  # weasyprint sem GTK/Pango no Windows cai aqui
    try:
        import pdfkit
        pdfkit.from_string(html, saida)
        print(f"PDF gerado (pdfkit): {saida}")
        return True
    except (ImportError, OSError, IOError):
        pass  # pdfkit sem wkhtmltopdf cai aqui
    try:
        from xhtml2pdf import pisa
        with open(saida, "wb") as f:
            status = pisa.CreatePDF(html, dest=f, encoding="utf-8")
        if not status.err:
            print(f"PDF gerado (xhtml2pdf): {saida}")
            return True
    except ImportError:
        pass
    html_path = saida.replace(".pdf", ".html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Nenhum motor de PDF disponível. HTML salvo em: {html_path}")
    print("  Instale um deles:")
    print("    pip install xhtml2pdf    (puro Python, funciona no Windows sem extras)")
    print("    pip install weasyprint    (requer GTK no Windows)")
    print("    pip install pdfkit + wkhtmltopdf")
    return False


def gerar_csv(data, saida):
    with open(saida, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["posicao", "questao_id", "titulo", "enunciado", "alternativas", "gabarito"])
        for q in data.get("questoes", []):
            alt_html = "<br>".join(
                f"<b>{a.get('letra', '')})</b> {a.get('texto', '')}" for a in q.get("alternativas", [])
            )
            w.writerow([
                q.get("posicao", ""),
                q.get("questaoId", ""),
                q.get("titulo", ""),
                q.get("enunciado", ""),
                alt_html,
                "",  # gabarito: preencha depois de resolver
            ])
    print(f"CSV gerado: {saida}")


def main():
    ap = argparse.ArgumentParser(description="JSON do Tec Concursos -> PDF/CSV")
    ap.add_argument("--json", default="meu_caderno_tec.json", help="JSON exportado pelo userscript")
    ap.add_argument("--pdf", default="", help="caminho do PDF de saída (padrão: nome do JSON com .pdf)")
    ap.add_argument("--csv", default="", help="caminho do CSV de saída")
    ap.add_argument("--no-pdf", action="store_true", help="não gerar PDF")
    ap.add_argument("--no-csv", action="store_true", help="não gerar CSV")
    ap.add_argument("--sem-imagens", action="store_true", help="não baixar imagens externas")
    args = ap.parse_args()

    if not os.path.exists(args.json):
        print(f"ERRO: {args.json} não encontrado. Exporte o JSON pelo painel do userscript primeiro.")
        sys.exit(1)

    print(f"Lendo {args.json}...")
    data = ler_json(args.json)
    print(f"  {data.get('coletadas', 0)} questões no arquivo.")

    base = Path(args.json).stem
    pdf_saida = args.pdf or (base + ".pdf")
    csv_saida = args.csv or (base + ".csv")

    # Imagens sempre ao lado do JSON, independente do diretório de execução
    pasta_imagens = os.path.join(os.path.dirname(os.path.abspath(args.json)), "imagens_tec")
    mapa = {} if args.sem_imagens else baixar_imagens(data, pasta_imagens)

    if not args.no_pdf:
        print("Montando HTML...")
        html = montar_html(data, mapa)
        gerar_pdf(html, pdf_saida)

    if not args.no_csv:
        gerar_csv(data, csv_saida)


if __name__ == "__main__":
    main()
