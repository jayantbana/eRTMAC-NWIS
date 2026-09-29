"""Page text acquisition: native text layer first, OCR fallback for scanned pages.

* A page is treated as scanned when its text layer is missing or unusable.
* OCR uses RapidOCR (PP-OCRv4 ONNX models, fully offline, pip-installable). Results are cached
  per document hash and page, so re-ingestion is fast.
* OCR engines often glue words together ("stuckat2951m"). A space-recovery step re-segments
  glued tokens using a vocabulary learned from the digital (text-layer) corpus.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import re
from collections import Counter
from pathlib import Path

import numpy as np
from pypdf import PdfReader

from .. import config

_OCR = None


def _ocr_engine():
    global _OCR
    if _OCR is None:
        from rapidocr_onnxruntime import RapidOCR  # lazy: heavy import
        _OCR = RapidOCR()
    return _OCR


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def text_layer_usable(text: str) -> bool:
    chars = len(re.sub(r"\s", "", text or ""))
    if chars < 50:
        return False
    tokens = re.findall(r"[A-Za-z]{2,}", text)
    return len(tokens) >= 8


def normalise_text(text: str) -> str:
    text = text.replace(" ", " ").replace("（", "(").replace("）", ")").replace("：", ":").replace("，", ",")
    return re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", "\n", text)).strip()


# ------------------------------------------------------------------------------------------
# Space recovery for OCR output
# ------------------------------------------------------------------------------------------
class Segmenter:
    """Max-probability word segmentation (unigram model learned from digital pages)."""

    def __init__(self, counts: Counter):
        self.total = sum(counts.values()) or 1
        self.logp = {w: math.log(c / self.total) for w, c in counts.items() if len(w) > 0}
        self.maxlen = max((len(w) for w in self.logp), default=1)

    def cost(self, w: str) -> float:
        if w in self.logp:
            return -self.logp[w]
        if re.fullmatch(r"[\d,.:/-]+", w):
            return 6.0 + 0.2 * len(w)  # numbers are fine as a unit
        return 12.0 + 3.0 * len(w)  # unknown word penalty grows with length

    def split(self, token: str) -> str:
        low = token.lower()
        n = len(low)
        best = [0.0] + [math.inf] * n
        back = [0] * (n + 1)
        for i in range(1, n + 1):
            for j in range(max(0, i - self.maxlen - 6), i):
                c = best[j] + self.cost(low[j:i])
                if c < best[i]:
                    best[i], back[i] = c, j
        parts, i = [], n
        while i > 0:
            parts.append(token[back[i]:i])
            i = back[i]
        return " ".join(reversed(parts))


def build_segmenter(texts: list[str]) -> Segmenter:
    counts: Counter = Counter()
    for t in texts:
        counts.update(w.lower() for w in re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)?|\d+(?:[.,]\d+)*", t))
    return Segmenter(counts)


_UNIT_WORDS = {"mtrs", "mtr", "metres", "meters", "mts", "md", "mmd", "feet"}


def _unit_fix(m: re.Match) -> str:
    """'2,951minBarail' -> '2,951 m inBarail' (a depth unit glued to the next word)."""
    num, unit, rest = m.group(1), m.group(2), m.group(3)
    try:
        val = float(num.replace(",", ""))
    except ValueError:
        return m.group(0)
    if val < 100 or (unit + rest).lower() in _UNIT_WORDS:
        return m.group(0)
    return f"{num} {unit} {rest}"


def recover_spaces(line: str, seg: Segmenter | None) -> str:
    """Repair common OCR artefacts, then re-split glued words with the learned vocabulary."""
    line = re.sub(r"(?<=\d)bb\s?[1l|I](?=\b|/|hr)", " bbl", line)  # 'bbl' read as 'bb 1'
    line = re.sub(r"\bbb\s?[1l|I](?=\b|/|hr)", "bbl", line)
    line = re.sub(r"\b(8|12|17|26)(1/2|1/4)\"", r'\1 \2"', line)
    line = re.sub(r"(?<=\))\.(?=[A-Z])", ". ", line)
    line = re.sub(r"(\d[\d,.]*\d)\s?(m|ft)([a-z]{2,}[A-Za-z]*)", _unit_fix, line)
    # Structural boundaries: lower->Upper, letters<->digits, punctuation glued to words.
    line = re.sub(r"(?<=[a-z])(?=[A-Z][a-z])", " ", line)
    line = re.sub(r"(?<=[a-z]{2})(?=[A-Z]{2,})", " ", line)
    line = re.sub(r"(?<=[A-Za-z]{2})(?=\d)", " ", line)
    line = re.sub(r"(?<=\d)(?=[A-Za-z]{2,})", " ", line)
    line = re.sub(r"(?<=\d')(?=[A-Za-z])", " ", line)
    line = re.sub(r"(?<=[:;,)])(?=[A-Za-z(])", " ", line)
    line = re.sub(r"(?<=[A-Za-z])(?=\()", " ", line)
    line = re.sub(r"(?<=[a-z]{2})\.(?=[A-Z][a-z])|(?<=[A-Z]{2})\.(?=[A-Z][a-z])", ". ", line)
    if seg is None:
        return line

    def fix(m: re.Match) -> str:
        run = m.group(0)
        if len(run) < 6 or run.lower() in seg.logp:
            return run
        return seg.split(run)

    return re.sub(r"[A-Za-z]+", fix, line)


# ------------------------------------------------------------------------------------------
# OCR
# ------------------------------------------------------------------------------------------
def ocr_page_image(img_bytes: bytes) -> tuple[list[str], float]:
    from PIL import Image

    arr = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"))
    result, _ = _ocr_engine()(arr, use_cls=False)
    if not result:
        return [], 0.0
    items = sorted(((float(b[0][1]), float(b[0][0]), t, float(c)) for b, t, c in result), key=lambda r: (r[0], r[1]))
    rows: list[list[tuple]] = []
    for it in items:
        if rows and abs(rows[-1][0][0] - it[0]) < 12:
            rows[-1].append(it)
        else:
            rows.append([it])
    lines = [" ".join(r[2] for r in sorted(row, key=lambda r: r[1])) for row in rows]
    conf = float(np.mean([it[3] for it in items]))
    return lines, conf


def extract_pages(pdf_path: Path, seg: Segmenter | None = None) -> list[dict]:
    """Return [{page, text, method, ocr_conf}] for every page (1-based)."""
    digest = sha256_file(pdf_path)
    cache_path = config.OCR_CACHE_DIR / f"{digest}.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    reader = PdfReader(str(pdf_path))
    pages = []
    dirty = False
    for i, page in enumerate(reader.pages, start=1):
        raw = page.extract_text() or ""
        if text_layer_usable(raw):
            pages.append({"page": i, "text": normalise_text(raw), "method": "text", "ocr_conf": None})
            continue
        key = str(i)
        if key not in cache:
            lines, conf = [], 0.0
            for im in page.images[:1]:
                lines, conf = ocr_page_image(im.data)
            cache[key] = {"lines": lines, "conf": conf}
            dirty = True
        lines = [recover_spaces(normalise_text(ln), seg) for ln in cache[key]["lines"]]
        pages.append({"page": i, "text": "\n".join(lines), "method": "ocr", "ocr_conf": round(cache[key]["conf"], 3)})
    if dirty:
        config.OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache))
    return pages
