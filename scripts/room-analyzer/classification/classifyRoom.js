const patterns = {
  bedroom:/bed|кроват|спаль/i, kitchen:/kitchen|кух|stove|oven|sink|плит|мойк/i,
  living_room:/sofa|диван|телевиз|\btv\b|living|гостин/i, bathroom:/bath|shower|ванн|душ/i,
  toilet:/toilet|унитаз|сануз|\bwc\b/i, office:/desk|office|кабин|computer|компьют/i,
  children_room:/nursery|детск|crib|кроватк/i, storage:/storage|кладов|pantry|гардероб|wardrobe/i,
  balcony:/balcon|лоджи|террас/i, hallway:/hall|corridor|прихож|корид/i
};
const labels = { bedroom:"Спальня", kitchen:"Кухня", living_room:"Гостиная", kitchen_living:"Кухня-гостиная", bathroom:"Ванная", toilet:"Санузел", office:"Кабинет", children_room:"Детская", storage:"Кладовая", balcony:"Балкон", hallway:"Коридор", unknown:"Комната" };

export function classifyRoom(objects) {
  const text = objects.map((object) => `${object.name || ""} ${object.userData?.name || ""} ${object.userData?.ifcType || ""}`).join(" ");
  const scores = Object.fromEntries(Object.entries(patterns).map(([type, pattern]) => [type, (text.match(new RegExp(pattern.source, "gi")) || []).length]));
  if (scores.kitchen && scores.living_room) return { type:"kitchen_living", confidence:Math.min(.95, .58 + (scores.kitchen + scores.living_room) * .06) };
  const [type, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || ["unknown", 0];
  return score ? { type, confidence:Math.min(.92, .48 + score * .09) } : { type:"unknown", confidence:.2 };
}

export function assignRoomNames(rooms) {
  const counts = {};
  for (const room of rooms) { const base = labels[room.type] || labels.unknown; counts[base] = (counts[base] || 0) + 1; room.name = `${base}${counts[base] > 1 ? ` ${counts[base]}` : ""}`; }
  return rooms;
}
