"use strict";

const CircuitLayout = (() => {
  function arrange(components, wires) {
    const parts = components.map(part => ({...part}));
    const byId = new Map(parts.map(part => [part.id, part]));
    const neighbors = new Map(parts.map(part => [part.id, new Set()]));
    for (const wire of wires) {
      neighbors.get(wire.from.id).add(wire.to.id);
      neighbors.get(wire.to.id).add(wire.from.id);
    }
    const rank = part => part.type === "voltage" ? 0 : part.type === "resistor" ? 1 :
      part.type === "capacitor" ? 2 : 3;
    const compare = (a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, "en");
    const unseen = new Set(parts.map(part => part.id));
    const groups = [];
    while (unseen.size) {
      const start = [...unseen].map(id => byId.get(id)).sort(compare)[0];
      const group = [], queue = [start.id];
      unseen.delete(start.id);
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        group.push(byId.get(id));
        const adjacent = [...neighbors.get(id)].filter(next => unseen.has(next))
          .map(next => byId.get(next)).sort(compare);
        for (const part of adjacent) {
          if (unseen.delete(part.id)) queue.push(part.id);
        }
      }
      groups.push(group);
    }
    let top = 0;
    for (const group of groups) {
      const ordinary = group.filter(part => part.type !== "ground");
      const grounds = group.filter(part => part.type === "ground");
      const columns = 6, rows = Math.max(1, Math.ceil(ordinary.length / columns));
      ordinary.forEach((part, i) => {
        part.x = (i % columns) * 240;
        part.y = top + Math.floor(i / columns) * 204;
        part.rotation = part.type === "resistor" ? 270 : 0;
      });
      grounds.forEach((part, i) => {
        part.x = (i % columns) * 240;
        part.y = top + rows * 204 + Math.floor(i / columns) * 168;
        part.rotation = 0;
      });
      top += rows * 204 + Math.ceil(grounds.length / columns) * 168 + 168;
    }
    return parts;
  }
  return {arrange};
})();
