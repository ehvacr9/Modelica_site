"use strict";

const WireRouter = (() => {
  const clearance = 12;

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

  function create(components, wires) {
    const parts = new Map(components.map(part => [part.id, part]));
    const obstacles = components.map(part => ({
      id: part.id, left: part.x - clearance, right: part.x + 120 + clearance,
      top: part.y - clearance, bottom: part.y + 72 + clearance
    }));
    function endpoint(end) {
      const part = parts.get(end.id);
      if (!part) return null;
      const point = {x: part.x + (end.port === "p" ? 0 : 120), y: part.y + 36};
      return {point, stub: {x: point.x + (end.port === "p" ? -clearance : clearance), y: point.y}, id: part.id};
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
    return {route};
  }
  return {create};
})();
