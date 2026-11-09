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
      part.type === "ammeter" ? 2 : part.type === "capacitor" ? 3 :
      part.type === "voltmeter" ? 4 : 5;
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
        const horizontalDefault = part.type === "resistor" || part.type === "ammeter";
        const flexible = horizontalDefault || part.type === "voltmeter";
        const horizontal = flexible && order >= 26 ?
          !!((order - 26) & (1 << (i % 5))) : horizontalDefault;
        part.y = top + Math.floor(i / columns) * 240 + (horizontal ? 0 : 72);
        part.rotation = horizontal ? 270 : 0;
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

  function evaluate(components, wires, preserveManual = false) {
    for (let i = 0; i < components.length; i++) {
      const a = components[i];
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
      for (let j = 0; j < i; j++) {
        const b = components[j];
        if (Math.abs(a.x - b.x) < 120 && Math.abs(a.y - b.y) < 72) return null;
      }
    }
    const router = WireRouter.create(components, wires);
    const routes = wires.map((wire, index) => {
      if (preserveManual && wire.route && !router.validManual(index, wire.route)) return null;
      const route = router.route(index);
      return route && router.validManual(index, route) ? route : null;
    });
    if (routes.some(route => !route)) return null;
    const geometry = WireRouter.crossings(wires, routes);
    const crossings = [...geometry.bridges.values()].reduce((sum, values) => sum + values.length, 0);
    let bends = 0, shortSegments = 0, length = 0, overlap = 0;
    const segments = [];
    for (const [wire, route] of routes.entries()) {
      bends += Math.max(0, route.length - 2);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i];
        const segment = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        length += segment;
        if (segment < 2 * WireRouter.gridSize) shortSegments++;
        const horizontal = a.y === b.y, axis = horizontal ? "x" : "y";
        segments.push({wire, horizontal, line: horizontal ? a.y : a.x,
          low: Math.min(a[axis], b[axis]), high: Math.max(a[axis], b[axis])});
      }
    }
    for (let i = 0; i < segments.length; i++) for (let j = 0; j < i; j++) {
      const a = segments[i], b = segments[j];
      if (a.wire !== b.wire && a.horizontal === b.horizontal && a.line === b.line)
        overlap += Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
    }
    return {ambiguous: geometry.ambiguous, crossings, bends, shortSegments, length, overlap,
      score: bends * 90 + shortSegments * 36 + length};
  }

  function optimize(components, originalWires) {
    const original = evaluate(components, originalWires, true);
    let best = original && {components, wires: originalWires, ...original, unchanged: true};
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
      const quality = evaluate(parts, wires);
      if (!quality) continue;
      if (original && ((!original.ambiguous && quality.ambiguous) ||
          quality.crossings > original.crossings || quality.bends > original.bends ||
          quality.shortSegments > original.shortSegments || quality.overlap > original.overlap)) continue;
      if (!best || Number(quality.ambiguous) < Number(best.ambiguous) ||
          (quality.ambiguous === best.ambiguous &&
            (quality.crossings < best.crossings ||
             (quality.crossings === best.crossings &&
               (quality.overlap < best.overlap ||
                (quality.overlap === best.overlap && quality.score < best.score))))))
        best = {components: parts, wires, ...quality, unchanged: false};
    }
    return best;
  }
  return {arrange, optimize};
})();
