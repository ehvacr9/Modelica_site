"use strict";

const WireRouter = (() => {
  const clearance = 12;

  function port(part, name) {
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const rotation = part.rotation === undefined ? 0 : part.rotation;
    const direction = directions[(rotation / 90 + (name === "n" ? 2 : 0)) % 4];
    return {x: part.x + 60 + direction[0] * 60, y: part.y + 36 + direction[1] * 36,
      dx: direction[0], dy: direction[1]};
  }

  function intersects(a, b, rect) {
    if (a.x === b.x)
      return a.x > rect.left && a.x < rect.right &&
        Math.max(a.y, b.y) > rect.top && Math.min(a.y, b.y) < rect.bottom;
    return a.y > rect.top && a.y < rect.bottom &&
      Math.max(a.x, b.x) > rect.left && Math.min(a.x, b.x) < rect.right;
  }

  function simplify(points) {
    const result = [];
    for (const point of points) {
      const last = result.at(-1), previous = result.at(-2);
      if (last && last.x === point.x && last.y === point.y) continue;
      if (previous && ((previous.x === last.x && last.x === point.x &&
          (last.y - previous.y) * (point.y - last.y) >= 0) ||
          (previous.y === last.y && last.y === point.y &&
          (last.x - previous.x) * (point.x - last.x) >= 0))) result.pop();
      result.push(point);
    }
    return result;
  }

  function shiftSegment(points, index, offset) {
    const start = points[index], end = points[index + 1];
    if (!start || !end || (start.x !== end.x && start.y !== end.y)) return null;
    const horizontal = start.y === end.y;
    const length = horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y);
    const needed = (index === 0 ? clearance : 0) + (index + 1 === points.length - 1 ? clearance : 0);
    if (length <= needed) return null;
    const sign = horizontal ? Math.sign(end.x - start.x) : Math.sign(end.y - start.y);
    const a = {...start}, b = {...end};
    if (index === 0) {
      if (horizontal) a.x += sign * clearance;
      else a.y += sign * clearance;
    }
    if (index + 1 === points.length - 1) {
      if (horizontal) b.x -= sign * clearance;
      else b.y -= sign * clearance;
    }
    const movedA = {...a}, movedB = {...b};
    if (horizontal) { movedA.y += offset; movedB.y += offset; }
    else { movedA.x += offset; movedB.x += offset; }
    const before = index === 0 ? [start, a] : points.slice(0, index);
    const after = index + 1 === points.length - 1 ? [b, end] : points.slice(index + 2);
    return simplify([...before, movedA, movedB, ...after]);
  }

  function crossings(wires, routes) {
    const parents = new Map();
    const key = end => `${end.id}.${end.port}`;
    function find(name) {
      if (!parents.has(name)) parents.set(name, name);
      if (parents.get(name) !== name) parents.set(name, find(parents.get(name)));
      return parents.get(name);
    }
    for (const wire of wires) parents.set(find(key(wire.from)), find(key(wire.to)));
    const nets = wires.map(wire => find(key(wire.from)));
    const segments = [];
    routes.forEach((route, wire) => {
      if (!route) return;
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i];
        if (a.x !== b.x || a.y !== b.y) segments.push({a, b, wire, index: i - 1, net: nets[wire], horizontal: a.y === b.y});
      }
    });
    const candidates = new Map(), bridges = new Map();
    let ambiguous = false;
    const contains = (segment, p) => segment.horizontal
      ? p.y === segment.a.y && p.x >= Math.min(segment.a.x, segment.b.x) && p.x <= Math.max(segment.a.x, segment.b.x)
      : p.x === segment.a.x && p.y >= Math.min(segment.a.y, segment.b.y) && p.y <= Math.max(segment.a.y, segment.b.y);
    function candidate(net, point) { candidates.set(`${net}|${point.x}|${point.y}`, {net, point}); }
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (a.wire === b.wire) continue;
      if (a.horizontal === b.horizontal) {
        if ((a.horizontal ? a.a.y !== b.a.y : a.a.x !== b.a.x)) continue;
        const axis = a.horizontal ? "x" : "y";
        const low = Math.max(Math.min(a.a[axis], a.b[axis]), Math.min(b.a[axis], b.b[axis]));
        const high = Math.min(Math.max(a.a[axis], a.b[axis]), Math.max(b.a[axis], b.b[axis]));
        if (low > high) continue;
        if (a.net !== b.net) { ambiguous = true; continue; }
        for (const value of [low, high]) candidate(a.net, a.horizontal ? {x: value, y: a.a.y} : {x: a.a.x, y: value});
      } else {
        const h = a.horizontal ? a : b, v = a.horizontal ? b : a;
        const point = {x: v.a.x, y: h.a.y};
        if (!contains(h, point) || !contains(v, point)) continue;
        if (a.net === b.net) candidate(a.net, point);
        else {
          const margin = 6;
          if (point.x - Math.min(h.a.x, h.b.x) < margin || Math.max(h.a.x, h.b.x) - point.x < margin ||
              point.y - Math.min(v.a.y, v.b.y) < margin || Math.max(v.a.y, v.b.y) - point.y < margin) {
            ambiguous = true;
          } else {
            const id = `${h.wire}:${h.index}`;
            if (!bridges.has(id)) bridges.set(id, []);
            bridges.get(id).push(point.x);
          }
        }
      }
    }
    const junctions = [];
    for (const {net, point} of candidates.values()) {
      const directions = new Set();
      for (const segment of segments) {
        if (segment.net !== net || !contains(segment, point)) continue;
        if (segment.horizontal) {
          if (Math.min(segment.a.x, segment.b.x) < point.x) directions.add("left");
          if (Math.max(segment.a.x, segment.b.x) > point.x) directions.add("right");
        } else {
          if (Math.min(segment.a.y, segment.b.y) < point.y) directions.add("up");
          if (Math.max(segment.a.y, segment.b.y) > point.y) directions.add("down");
        }
      }
      if (directions.size >= 3) junctions.push(point);
    }
    for (const values of bridges.values()) {
      const sorted = [...new Set(values)].sort((a, b) => a - b);
      if (sorted.some((value, i) => i > 0 && value - sorted[i - 1] < 12)) ambiguous = true;
    }
    return {junctions, bridges, ambiguous};
  }

  function create(components, wires) {
    const parts = new Map(components.map(part => [part.id, part]));
    const obstacles = components.map(part => ({
      id: part.id, left: part.x - clearance, right: part.x + 120 + clearance,
      top: part.y - clearance, bottom: part.y + 72 + clearance
    }));
    function endpoint(end) {
      const part = parts.get(end.id);
      if (!part) return null;
      const position = port(part, end.port);
      const point = {x: position.x, y: position.y};
      return {point, stub: {x: point.x + position.dx * clearance, y: point.y + position.dy * clearance}, id: part.id};
    }
    const endpoints = wires.map(wire => [endpoint(wire.from), endpoint(wire.to)]);
    let grid;

    function buildGrid() {
      const xs = new Set(), ys = new Set();
      for (const box of obstacles) {
        xs.add(box.left); xs.add(box.right); ys.add(box.top); ys.add(box.bottom);
      }
      for (const pair of endpoints) for (const end of pair) if (end) {
        xs.add(end.stub.x); ys.add(end.stub.y);
      }
      const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
      const xIndex = new Map(x.map((v, i) => [v, i])), yIndex = new Map(y.map((v, i) => [v, i]));
      const width = x.length, size = width * y.length;
      const blocked = new Uint8Array(size), horizontal = new Uint8Array(size), vertical = new Uint8Array(size);
      for (const box of obstacles) {
        const left = xIndex.get(box.left), right = xIndex.get(box.right);
        const top = yIndex.get(box.top), bottom = yIndex.get(box.bottom);
        for (let row = top + 1; row < bottom; row++) {
          for (let col = left; col < right; col++) horizontal[row * width + col] = 1;
          for (let col = left + 1; col < right; col++) blocked[row * width + col] = 1;
        }
        for (let col = left + 1; col < right; col++)
          for (let row = top; row < bottom; row++) vertical[row * width + col] = 1;
      }
      return {x, y, xIndex, yIndex, width, blocked, horizontal, vertical};
    }

    function search(start, end) {
      if (!grid) grid = buildGrid();
      const {x, y, xIndex, yIndex, width, blocked, horizontal, vertical} = grid;
      const first = yIndex.get(start.y) * width + xIndex.get(start.x);
      const last = yIndex.get(end.y) * width + xIndex.get(end.x);
      if (blocked[first] || blocked[last]) return null;
      const distance = new Float64Array(blocked.length); distance.fill(Infinity);
      const previous = new Int32Array(blocked.length); previous.fill(-1);
      const heap = [];
      function push(id, score, cost) {
        let index = heap.length;
        heap.push({id, score, cost});
        while (index > 0) {
          const parent = Math.floor((index - 1) / 2);
          if (heap[parent].score <= score) break;
          heap[index] = heap[parent]; index = parent;
        }
        heap[index] = {id, score, cost};
      }
      function pop() {
        const result = heap[0], tail = heap.pop();
        if (heap.length) {
          let index = 0;
          while (index * 2 + 1 < heap.length) {
            let child = index * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
            if (heap[child].score >= tail.score) break;
            heap[index] = heap[child]; index = child;
          }
          heap[index] = tail;
        }
        return result;
      }
      distance[first] = 0;
      push(first, Math.abs(start.x - end.x) + Math.abs(start.y - end.y), 0);
      while (heap.length) {
        const current = pop(), id = current.id;
        if (current.cost !== distance[id]) continue;
        if (id === last) {
          const result = [];
          for (let i = last; i !== -1; i = previous[i]) result.push({x: x[i % width], y: y[Math.floor(i / width)]});
          return result.reverse();
        }
        const col = id % width, row = Math.floor(id / width);
        const neighbors = [];
        if (col > 0 && !horizontal[id - 1]) neighbors.push(id - 1);
        if (col + 1 < width && !horizontal[id]) neighbors.push(id + 1);
        if (row > 0 && !vertical[id - width]) neighbors.push(id - width);
        if (row + 1 < y.length && !vertical[id]) neighbors.push(id + width);
        for (const next of neighbors) {
          if (blocked[next]) continue;
          const nx = x[next % width], ny = y[Math.floor(next / width)];
          const cost = current.cost + Math.abs(nx - x[col]) + Math.abs(ny - y[row]);
          if (cost >= distance[next]) continue;
          distance[next] = cost; previous[next] = id;
          push(next, cost + Math.abs(nx - end.x) + Math.abs(ny - end.y), cost);
        }
      }
      return null;
    }

    function route(index) {
      const [a, b] = endpoints[index];
      if (!a || !b) return null;
      for (const box of obstacles) {
        if ((box.id !== a.id && intersects(a.point, a.stub, box)) ||
            (box.id !== b.id && intersects(b.point, b.stub, box))) return null;
      }
      const clear = points => points.slice(1).every((point, i) =>
        obstacles.every(box => !intersects(points[i], point, box)));
      for (const corner of [{x: a.stub.x, y: b.stub.y}, {x: b.stub.x, y: a.stub.y}]) {
        const direct = [a.stub, corner, b.stub];
        if (clear(direct)) return simplify([a.point, ...direct, b.point]);
      }
      const path = search(a.stub, b.stub);
      return path ? simplify([a.point, ...path, b.point]) : null;
    }
    function validManual(index, points) {
      const [a, b] = endpoints[index];
      if (!a || !b || !Array.isArray(points) || points.length < 2 || points.length > 200) return false;
      if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
          Math.abs(p.x) > 1000000 || Math.abs(p.y) > 1000000)) return false;
      if (points[0].x !== a.point.x || points[0].y !== a.point.y ||
          points.at(-1).x !== b.point.x || points.at(-1).y !== b.point.y) return false;
      const outward = (point, end) => (point.x - end.point.x) * (end.stub.x - end.point.x) +
        (point.y - end.point.y) * (end.stub.y - end.point.y);
      if (outward(points[1], a) < clearance * clearance ||
          outward(points.at(-2), b) < clearance * clearance) return false;
      return points.slice(1).every((point, i) => {
        const previous = points[i];
        if ((point.x !== previous.x && point.y !== previous.y) ||
            (point.x === previous.x && point.y === previous.y)) return false;
        return obstacles.every(box => {
          if (i === 0 && box.id === a.id) return !intersects(a.stub, point, box);
          if (i === points.length - 2 && box.id === b.id) return !intersects(previous, b.stub, box);
          return !intersects(previous, point, box);
        });
      });
    }
    return {route, validManual};
  }
  return {create, port, shiftSegment, crossings};
})();
