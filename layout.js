"use strict";

const CircuitLayout = (() => {
  function groupsFor(parts, wires) {
    const byId = new Map(parts.map(part => [part.id, part]));
    const neighbors = new Map(parts.map(part => [part.id, new Set()]));
    for (const wire of wires) {
      neighbors.get(wire.from.id).add(wire.to.id);
      neighbors.get(wire.to.id).add(wire.from.id);
    }
    const rank = part => part.type === "voltage" ? 0 : part.type === "resistor" ? 1 :
      part.type === "capacitor" ? 2 : 3;
    const compare = (a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, "en");
    const unseen = new Set(parts.map(part => part.id)), groups = [];
    while (unseen.size) {
      const start = [...unseen].map(id => byId.get(id)).sort(compare)[0];
      const group = [], queue = [start.id];
      unseen.delete(start.id);
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        group.push(byId.get(id));
        const adjacent = [...neighbors.get(id)].filter(next => unseen.has(next))
          .map(next => byId.get(next)).sort(compare);
        for (const part of adjacent) if (unseen.delete(part.id)) queue.push(part.id);
      }
      groups.push(group);
    }
    return groups;
  }

  function arrange(components, wires, variant = 0) {
    const parts = components.map(part => ({...part}));
    const groups = groupsFor(parts, wires);
    let top = 0;
    for (const group of groups) {
      const ordinary = group.filter(part => part.type !== "ground");
      const grounds = group.filter(part => part.type === "ground");
      const order = Math.floor(variant / 2);
      if (order === 1) ordinary.reverse();
      if (order >= 2) {
        let pair = order - 2;
        for (let i = 0; i < ordinary.length; i++) {
          for (let j = i + 1; j < ordinary.length; j++) {
            if (pair-- === 0) [ordinary[i], ordinary[j]] = [ordinary[j], ordinary[i]];
          }
        }
      }
      if (order >= 26 && ordinary.length > 3) {
        let seed = order * 2654435761 >>> 0;
        for (let i = ordinary.length - 1; i > 0; i--) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const j = seed % (i + 1);
          [ordinary[i], ordinary[j]] = [ordinary[j], ordinary[i]];
        }
      }
      const columns = ordinary.length > 3 && order >= 26 && order % 3 === 0 ? 3 :
        ordinary.length > 3 && order >= 26 && order % 3 === 1 ? 4 : 6;
      const rows = Math.max(1, Math.ceil(ordinary.length / columns));
      const spacing = variant % 2 ? 216 : 240;
      ordinary.forEach((part, i) => {
        part.x = (i % columns) * spacing;
        part.y = top + Math.floor(i / columns) * 240 + (part.type === "resistor" ? 0 : 72);
        part.rotation = part.type === "resistor" ? 270 : 0;
      });
      grounds.forEach((part, i) => {
        part.x = (i % columns) * spacing;
        part.y = top + rows * 240 + 24 + Math.floor(i / columns) * 168;
        part.rotation = 0;
      });
      top += rows * 240 + Math.ceil(grounds.length / columns) * 168 + 168;
    }
    return parts;
  }

  function optimize(components, originalWires) {
    let best = null;
    const n = components.filter(part => part.type !== "ground").length;
    const count = components.length <= 20 && originalWires.length <= 40 ?
      (n >= 4 ? 72 : 2 * (2 + n * (n - 1) / 2)) : 4;
    for (let variant = 0; variant < count; variant++) {
      const parts = arrange(components, originalWires, variant);
      const wires = originalWires.map(wire => {
        const copy = {...wire};
        if (wire.branch) copy.branch = {...wire.branch};
        delete copy.route;
        return copy;
      });
      for (const [index, wire] of wires.entries()) {
        if (wire.branch) continue;
        const from = parts.find(part => part.id === wire.from.id);
        const to = parts.find(part => part.id === wire.to.id);
        const a = WireRouter.port(from, wire.from.port), b = WireRouter.port(to, wire.to.port);
        if (a.dy !== 1 || b.dy !== 1 || a.x === b.x) continue;
        const y = Math.max(a.y, b.y) + 60;
        const route = WireRouter.simplify([a, {x: a.x, y}, {x: b.x, y}, b])
          .map(({x, y}) => ({x, y}));
        if (WireRouter.create(parts, wires).validManual(index, route)) wire.route = route;
      }
      for (const wire of wires) {
        const ground = parts.find(part => part.id === wire.from.id && part.type === "ground");
        if (!ground || !wire.branch) continue;
        const parent = WireRouter.create(parts, wires).route(wire.branch.parent);
        if (!parent) continue;
        const horizontal = parent.slice(1).map((point, i) => [parent[i], point])
          .filter(([a, b]) => a.y === b.y && Math.abs(a.x - b.x) >= 2 * WireRouter.gridSize)
          .sort((a, b) => b[0].y - a[0].y || Math.abs(b[1].x - b[0].x) - Math.abs(a[1].x - a[0].x))[0];
        if (!horizontal) continue;
        const x = WireRouter.snap((horizontal[0].x + horizontal[1].x) / 2);
        const desiredX = x - 60;
        if (!parts.some(part => part !== ground && Math.abs(part.x - desiredX) < 120 &&
            Math.abs(part.y - ground.y) < 72)) ground.x = desiredX;
        const nearest = WireRouter.nearest(parent, {x: ground.x + 60, y: ground.y});
        if (nearest) wire.branch.fraction = Math.max(0.000001, Math.min(0.999999, nearest.fraction));
      }
      const router = WireRouter.create(parts, wires);
      const routes = wires.map((wire, index) => router.route(index));
      if (routes.some(route => !route)) continue;
      const geometry = WireRouter.crossings(wires, routes);
      let score = geometry.ambiguous ? 1000000 : 0;
      for (const values of geometry.bridges.values()) score += values.length * 1000;
      for (const route of routes) {
        score += (route.length - 2) * 90;
        for (let i = 1; i < route.length; i++)
          score += Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y);
      }
      if (!best || score < best.score) best = {components: parts, wires, score};
    }
    return best;
  }
  return {arrange, optimize};
})();
