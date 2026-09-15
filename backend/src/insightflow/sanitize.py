"""DuckDB hata mesajlarından veri değerlerini temizler.

Hata mesajları veri içerebilir: `Could not convert string 'Ahmet Yılmaz' to INT32` veya
`value 184250.75 is out of range`. Self-healing döngüsünde LLM'e yalnızca hatanın biçimi gider.
Sütun adları (çift tırnaklı) korunur; LLM onları zaten şemadan biliyor ve onarım için gerekli.
"""

import re

MAX_ERROR_LENGTH = 600

_SINGLE_QUOTED = re.compile(r"'(?:[^']|'')*'")
_NUMBER = re.compile(r"(?<![\w\"])-?\d+(?:[.,]\d+)?(?![\w\"])")
_LINE_PREFIX = re.compile(r"\bLINE \d+:")
_WHITESPACE = re.compile(r"[ \t]+")


def sanitize_error(message: str) -> str:
    text = _SINGLE_QUOTED.sub("'…'", message)
    # "LINE 1:" konum bilgisini koru, diğer sayıları maskele.
    lines = []
    for line in text.splitlines():
        prefix = _LINE_PREFIX.match(line)
        head = prefix.group(0) if prefix else ""
        lines.append(head + _NUMBER.sub("#", line[len(head):]))
    text = _WHITESPACE.sub(" ", "\n".join(lines)).strip()
    return text[:MAX_ERROR_LENGTH]
