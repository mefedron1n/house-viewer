"""Extract wall elements from an IFC model for use in a web viewer.

Usage:
    pip install ifcopenshell
    python extract_ifc_walls.py path/to/model.ifc --output models/walls.json

The generated JSON contains IFC express IDs and GlobalIds. When converting the
IFC to GLB, preserve one of these values in each mesh's metadata/name; the web
viewer can then use walls.json to hide only wall meshes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


WALL_TYPES = ("IfcWall", "IfcWallStandardCase", "IfcCurtainWall")


def value_of(property_value):
    """Return a JSON-compatible IFC property value."""
    if property_value is None:
        return None
    wrapped = getattr(property_value, "wrappedValue", None)
    return wrapped if wrapped is not None else str(property_value)


def read_properties(element):
    """Extract simple property-set values useful for identifying a wall."""
    properties = {}
    for definition in getattr(element, "IsDefinedBy", []) or []:
        prop_set = getattr(definition, "RelatingPropertyDefinition", None)
        if not prop_set or not prop_set.is_a("IfcPropertySet"):
            continue
        for prop in getattr(prop_set, "HasProperties", []) or []:
            if prop.is_a("IfcPropertySingleValue"):
                properties[prop.Name] = value_of(prop.NominalValue)
    return properties


def extract_walls(input_path: Path):
    try:
        import ifcopenshell
    except ImportError as error:
        raise RuntimeError(
            "Не найдена библиотека ifcopenshell. Установите её командой: "
            "pip install ifcopenshell"
        ) from error

    model = ifcopenshell.open(str(input_path))
    walls = []
    for ifc_type in WALL_TYPES:
        for element in model.by_type(ifc_type):
            walls.append({
                "expressId": element.id(),
                "globalId": getattr(element, "GlobalId", None),
                "ifcType": element.is_a(),
                "name": getattr(element, "Name", None) or "Без названия",
                "description": getattr(element, "Description", None),
                "properties": read_properties(element),
            })

    # GlobalId is stable; expressId also helps converters that retain numeric IFC ids.
    return {
        "source": input_path.name,
        "wallCount": len(walls),
        "wallGlobalIds": [wall["globalId"] for wall in walls if wall["globalId"]],
        "wallExpressIds": [wall["expressId"] for wall in walls],
        "walls": walls,
    }


def main():
    parser = argparse.ArgumentParser(description="Определить стены в IFC-файле")
    parser.add_argument("input", type=Path, help="Путь к IFC-файлу")
    parser.add_argument("--output", "-o", type=Path, default=Path("walls.json"),
                        help="Файл JSON для сайта (по умолчанию walls.json)")
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"Файл не найден: {args.input}")

    try:
        result = extract_walls(args.input)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Найдено стен: {result['wallCount']}. Манифест сохранён: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
