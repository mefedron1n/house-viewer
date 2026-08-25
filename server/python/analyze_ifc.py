#!/usr/bin/env python3
"""Extract BIM semantics before IFC geometry is converted to GLB."""
import json, math, sys
from collections import Counter, defaultdict
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.shape
import ifcopenshell.guid

SOURCE, TARGET = sys.argv[1:3]
model = ifcopenshell.open(SOURCE)
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)

def value(obj, name, default=None):
    result = getattr(obj, name, default)
    return None if result is None else str(result)

def mesh_id(obj):
    guid = value(obj, "GlobalId")
    if not guid: return None
    raw = ifcopenshell.guid.expand(guid)
    uuid = f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}".lower()
    return f"product-{uuid}-body"

def props(obj):
    try: return ifcopenshell.util.element.get_psets(obj, psets_only=False)
    except Exception: return {}

_metrics = {}
def metrics(obj):
    if obj.id() in _metrics: return _metrics[obj.id()]
    try:
        shape = ifcopenshell.geom.create_shape(settings, obj)
        verts = shape.geometry.verts
        # IfcConvert GLB uses Y-up; IFC coordinates are Z-up.
        points = [(x, z, -y) for x, y, z in zip(verts[0::3], verts[1::3], verts[2::3])]
        result = {"bounds": {"min": [min(p[i] for p in points) for i in range(3)], "max": [max(p[i] for p in points) for i in range(3)]},
          "area": ifcopenshell.util.shape.get_footprint_area(shape.geometry), "volume": ifcopenshell.util.shape.get_volume(shape.geometry)} if points else {}
    except Exception: result = {}
    _metrics[obj.id()] = result
    return result

def bounds(obj): return metrics(obj).get("bounds")

def quantity(obj, words):
    for group in props(obj).values():
        if not isinstance(group, dict): continue
        for key, raw in group.items():
            if any(word in key.lower() for word in words) and isinstance(raw, (int, float)): return raw
    if any(word in ("area","площад") for word in words): return metrics(obj).get("area")
    if any(word in ("volume","объем","объём") for word in words): return metrics(obj).get("volume")
    return None

def parent_storey(obj):
    try:
        parent = ifcopenshell.util.element.get_container(obj)
        while parent and not parent.is_a("IfcBuildingStorey"):
            parent = ifcopenshell.util.element.get_container(parent)
        return value(parent, "GlobalId") if parent else None
    except Exception: return None

storeys = []
for storey in model.by_type("IfcBuildingStorey"):
    storeys.append({"id": value(storey,"GlobalId"), "ifcGuid": value(storey,"GlobalId"), "name": value(storey,"Name","Этаж"), "elevation": getattr(storey,"Elevation",None), "roomIds": []})

spaces_raw = []
for index, space in enumerate(model.by_type("IfcSpace"), 1):
    box = bounds(space)
    center = [(box["min"][i]+box["max"][i])/2 for i in range(3)] if box else None
    room = {"id": value(space,"GlobalId") or f"room-{index}", "ifcGuid": value(space,"GlobalId"), "expressId": space.id(),
      "name": value(space,"LongName") or value(space,"Name") or f"Комната {index}", "longName": value(space,"LongName"),
      "storeyId": parent_storey(space), "area": quantity(space,["area","площад"]), "volume": quantity(space,["volume","объем","объём"]),
      "bounds": box, "center": center, "boundaryElementIds": [], "doorIds": [], "windowIds": [], "wallIds": [], "floorIds": [], "ceilingIds": [],
      "meshIds": [mesh_id(space)], "source":"ifc-space", "confidence":1, "properties":props(space)}
    spaces_raw.append(room)

# Archicad may export "Space containment: Off". Preserve storey grouping anyway.
for room in spaces_raw:
    if room["storeyId"] or not storeys: continue
    if len(storeys) == 1: room["storeyId"] = storeys[0]["id"]
    elif room["center"]:
        room["storeyId"] = min(storeys, key=lambda item: abs((item["elevation"] or 0)-room["center"][1]))["id"]

standard = {"IfcWall":"wall","IfcWallStandardCase":"wall","IfcDoor":"door","IfcWindow":"window","IfcSlab":"floor","IfcRoof":"roof","IfcColumn":"column","IfcFurniture":"furniture"}
classes = ["IfcWall","IfcDoor","IfcWindow","IfcSlab","IfcColumn","IfcBeam","IfcRoof","IfcCurtainWall","IfcStair","IfcRailing","IfcFurniture","IfcBuildingElementProxy"]
seen, elements = set(), []
for cls in classes:
    for obj in model.by_type(cls):
        if obj.id() in seen: continue
        seen.add(obj.id())
        elements.append({"id":value(obj,"GlobalId") or f"element-{obj.id()}", "ifcGuid":value(obj,"GlobalId"), "expressId":obj.id(), "ifcType":obj.is_a(),
          "resolvedType":standard.get(obj.is_a(),"other"), "name":value(obj,"Name"), "objectType":value(obj,"ObjectType"), "tag":value(obj,"Tag"),
          "predefinedType":value(obj,"PredefinedType"), "properties":props(obj), "bounds":bounds(obj), "meshIds":[mesh_id(obj)], "adjacentRoomIds":[],
          "confidence":1 if obj.is_a() in standard else .15, "classificationSignals":["ifcType"] if obj.is_a() in standard else []})

by_id = {e["id"]: e for e in elements}
rooms_by_id = {r["id"]: r for r in spaces_raw}
# IfcConvert --center-model plus the viewer's ground alignment yields this frame.
all_boxes = [item["bounds"] for item in spaces_raw + elements if item.get("bounds")]
if all_boxes:
    project_min = [min(box["min"][i] for box in all_boxes) for i in range(3)]
    project_max = [max(box["max"][i] for box in all_boxes) for i in range(3)]
    offset = [(project_min[0]+project_max[0])/2, project_min[1], (project_min[2]+project_max[2])/2]
    for item in spaces_raw + elements:
        if not item.get("bounds"): continue
        item["bounds"] = {side:[item["bounds"][side][i]-offset[i] for i in range(3)] for side in ("min","max")}
        if "center" in item: item["center"]=[item["center"][i]-offset[i] for i in range(3)]
boundaries = []
for rel in model.by_type("IfcRelSpaceBoundary"):
    room_id = value(getattr(rel,"RelatingSpace",None),"GlobalId")
    element_id = value(getattr(rel,"RelatedBuildingElement",None),"GlobalId")
    if room_id not in rooms_by_id or element_id not in by_id: continue
    element = by_id[element_id]; room = rooms_by_id[room_id]
    if room_id not in element["adjacentRoomIds"]: element["adjacentRoomIds"].append(room_id)
    if element_id not in room["boundaryElementIds"]: room["boundaryElementIds"].append(element_id)
    key = {"wall":"wallIds","door":"doorIds","window":"windowIds","floor":"floorIds","ceiling":"ceilingIds"}.get(element["resolvedType"])
    if key and element_id not in room[key]: room[key].append(element_id)
    boundaries.append({"roomId":room_id,"elementId":element_id,"type":element["resolvedType"],"internalOrExternal":"external" if str(getattr(rel,"InternalOrExternalBoundary","")).endswith("EXTERNAL") else "internal"})

def contains_many(space):
    if not space["bounds"]: return False
    total=0
    for other in spaces_raw:
        if other is space or not other["bounds"]: continue
        hit=True
        for i in range(3):
            if other["bounds"]["min"][i] < space["bounds"]["min"][i]-.05 or other["bounds"]["max"][i] > space["bounds"]["max"][i]+.05: hit=False
        total += int(hit)
    return total >= 2

aggregate, rooms = [], []
for room in spaces_raw:
    technical = room["name"].strip().lower() in ("общая площадь","total area","gross area") or contains_many(room)
    (aggregate if technical else rooms).append(room)
for storey in storeys: storey["roomIds"]=[r["id"] for r in rooms if r["storeyId"]==storey["id"]]
connections=[]
for element in elements:
    adjacent=element["adjacentRoomIds"]
    if len(adjacent)>1:
        for i in range(len(adjacent)-1): connections.append({"roomA":adjacent[i],"roomB":adjacent[i+1],"viaElementId":element["id"],"type":"door" if element["resolvedType"]=="door" else "adjacent"})
counts=Counter(e["ifcType"] for e in elements)
result={"schema":model.schema,"storeys":storeys,"rooms":rooms,"aggregateSpaces":aggregate,"spaces":spaces_raw,"elements":elements,"boundaries":boundaries,"connections":connections,
 "analysis":{"schema":model.schema,"storeys":len(storeys),"spaces":len(spaces_raw),"usableRooms":len(rooms),"aggregateSpaces":len(aggregate),"ifcTypes":dict(counts),"resolvedTypes":dict(Counter(e["resolvedType"] for e in elements)),"warnings":[] if spaces_raw else ["IfcSpace отсутствует: геометрический fallback выполняется во viewer"]}}
with open(TARGET,"w",encoding="utf-8") as stream: json.dump(result,stream,ensure_ascii=False,indent=2)
