#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

ROW = re.compile(r"^(?P<name>.+?)\s+\d{3}\s+(?P<code>\S+)$")
PAGE = re.compile(r"^\d{2}\.\d{2}\.\d{4}\s+T\d+\.\d+\s+Seite\s+\d+$")
HEADING = re.compile(r"^[A-Z]\s+Zone\s+Entwerter$")


def parse(path: Path) -> tuple[dict[str, str], list[str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    end = next(i for i, line in enumerate(lines) if line.strip() == "}")
    seed = "\n".join(lines[: end + 1])
    seed = re.sub(r",\s*\n\s*}", "\n}", seed)
    stations = json.loads(seed)
    warnings = []
    pending = None
    previous_code = None

    for number, raw_line in enumerate(lines[end + 1 :], start=end + 2):
        line = " ".join(raw_line.split())
        if not line or PAGE.fullmatch(line) or HEADING.fullmatch(line):
            pending = None
            previous_code = None
            continue

        match = ROW.fullmatch(line)
        if line.startswith("-") and pending is not None:
            match = ROW.fullmatch(f"{pending}{line}")
            pending = None
        if match is None and line.startswith("-") and previous_code is not None:
            continued_code = f"{previous_code}{line}"
            stations[continued_code] = stations.pop(previous_code)
            previous_code = continued_code
            continue

        if match is None:
            pending = line if not line.startswith("-") else None
            previous_code = None
            if pending is None:
                warnings.append(f"Zeile {number}: {raw_line}")
            continue

        name = re.sub(r"\s+(-)", r"\1", match.group("name")).strip()
        previous_code = match.group("code")
        stations[previous_code] = name

    if pending is not None:
        warnings.append(f"Zeile {len(lines)}: {pending}")
    return stations, warnings


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Aufruf: python3 int/format_didok.py INPUT [OUTPUT]")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2]) if len(sys.argv) == 3 else source.with_name(f"{source.stem}-formatted.json")
    stations, warnings = parse(source)
    target.write_text(
        json.dumps(stations, ensure_ascii=False, indent="\t") + "\n",
        encoding="utf-8",
    )
    print(f"{len(stations)} Einträge geschrieben: {target}")
    for warning in warnings:
        print(f"Übersprungen: {warning}", file=sys.stderr)


if __name__ == "__main__":
    main()
