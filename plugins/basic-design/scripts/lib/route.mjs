// 障害物(他ノード矩形)を避ける直交(水平・垂直)ルーティング。
// 非 ER の source/target 型エッジ(architecture / screen-flow)に用いる。
// 依存ゼロ・決定的(乱数・時刻不使用)。

const MARGIN = 12;

function centerX(n) {
  return n.x + n.width / 2;
}
function centerY(n) {
  return n.y + n.height / 2;
}

// 軸整列セグメント(幅0の矩形)と、MARGIN 膨張した障害物矩形の AABB 交差。
// 端点が矩形辺上に触れるだけのケースは strict 不等号により非交差とする。
function segHitsRect(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const rx = rect.x - MARGIN;
  const ry = rect.y - MARGIN;
  const rx2 = rect.x + rect.width + MARGIN;
  const ry2 = rect.y + rect.height + MARGIN;
  return minX < rx2 && rx < maxX && minY < ry2 && ry < maxY;
}

function pathClear(points, obstacles) {
  for (let i = 0; i < points.length - 1; i++) {
    for (const o of obstacles) {
      if (segHitsRect(points[i], points[i + 1], o)) return false;
    }
  }
  return true;
}

// 連続する重複点と、直線上に並ぶ中間点を除去して最小の点列にする。
function simplify(points) {
  const uniq = [];
  for (const p of points) {
    const last = uniq[uniq.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    uniq.push({ x: p.x, y: p.y });
  }
  if (uniq.length <= 2) return uniq;
  const out = [uniq[0]];
  for (let i = 1; i < uniq.length - 1; i++) {
    const a = out[out.length - 1];
    const b = uniq[i];
    const c = uniq[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(uniq[uniq.length - 1]);
  return out;
}

export function routeOrthogonal(fromNode, toNode, obstacles) {
  const fcx = centerX(fromNode);
  const fcy = centerY(fromNode);
  const tcx = centerX(toNode);
  const tcy = centerY(toNode);
  const dx = tcx - fcx;
  const dy = tcy - fcy;
  const xSeparated =
    fromNode.x + fromNode.width <= toNode.x ||
    toNode.x + toNode.width <= fromNode.x;
  const ySeparated =
    fromNode.y + fromNode.height <= toNode.y ||
    toNode.y + toNode.height <= fromNode.y;

  // 支配軸の投影が重なる場合、その軸の対向アンカーは互いの矩形側へ
  // 入り込むことがある。もう一方の軸で矩形が分離していればそちらを使う。
  const horizontal =
    xSeparated !== ySeparated ? xSeparated : Math.abs(dx) >= Math.abs(dy);

  let fromA;
  let toA;
  if (horizontal) {
    if (dx >= 0) {
      fromA = { x: fromNode.x + fromNode.width, y: fcy }; // from 右辺中点
      toA = { x: toNode.x, y: tcy }; //                       to 左辺中点
    } else {
      fromA = { x: fromNode.x, y: fcy }; //                    from 左辺中点
      toA = { x: toNode.x + toNode.width, y: tcy }; //         to 右辺中点
    }
  } else if (dy >= 0) {
    fromA = { x: fcx, y: fromNode.y + fromNode.height }; //    from 下辺中点
    toA = { x: tcx, y: toNode.y }; //                          to 上辺中点
  } else {
    fromA = { x: fcx, y: fromNode.y }; //                      from 上辺中点
    toA = { x: tcx, y: toNode.y + toNode.height }; //          to 下辺中点
  }

  // (a) 直線: アンカーが軸整列している場合のみ
  if ((horizontal && fromA.y === toA.y) || (!horizontal && fromA.x === toA.x)) {
    const straight = [fromA, toA];
    if (pathClear(straight, obstacles)) return straight;
  }

  const allRects = [fromNode, toNode, ...obstacles];

  if (horizontal) {
    // (b) Z 字(H-V-H): 中間の縦チャネル cx を試す
    const lo = Math.min(fromA.x, toA.x);
    const hi = Math.max(fromA.x, toA.x);
    const cands = [(fromA.x + toA.x) / 2];
    for (const o of obstacles) {
      cands.push(o.x - MARGIN, o.x + o.width + MARGIN);
    }
    for (const cx of cands) {
      if (cx <= lo || cx >= hi) continue;
      const path = [fromA, { x: cx, y: fromA.y }, { x: cx, y: toA.y }, toA];
      if (pathClear(path, obstacles)) return simplify(path);
    }
    // (c) 外周迂回: 全矩形の上または下に横チャネル cy を取る
    const top = Math.min(...allRects.map((r) => r.y)) - MARGIN;
    const bottom = Math.max(...allRects.map((r) => r.y + r.height)) + MARGIN;
    for (const cy of [top, bottom]) {
      const path = [fromA, { x: fromA.x, y: cy }, { x: toA.x, y: cy }, toA];
      if (pathClear(path, obstacles)) return simplify(path);
    }
    // (d) 妥協: Z 字(中点)
    const cx = (fromA.x + toA.x) / 2;
    return simplify([fromA, { x: cx, y: fromA.y }, { x: cx, y: toA.y }, toA]);
  }

  // 縦方向主体(x/y を入れ替えた対称処理)
  // (b) Z 字(V-H-V): 中間の横チャネル cy を試す
  const lo = Math.min(fromA.y, toA.y);
  const hi = Math.max(fromA.y, toA.y);
  const cands = [(fromA.y + toA.y) / 2];
  for (const o of obstacles) {
    cands.push(o.y - MARGIN, o.y + o.height + MARGIN);
  }
  for (const cy of cands) {
    if (cy <= lo || cy >= hi) continue;
    const path = [fromA, { x: fromA.x, y: cy }, { x: toA.x, y: cy }, toA];
    if (pathClear(path, obstacles)) return simplify(path);
  }
  // (c) 外周迂回: 全矩形の左または右に縦チャネル cx を取る
  const left = Math.min(...allRects.map((r) => r.x)) - MARGIN;
  const right = Math.max(...allRects.map((r) => r.x + r.width)) + MARGIN;
  for (const cx of [left, right]) {
    const path = [fromA, { x: cx, y: fromA.y }, { x: cx, y: toA.y }, toA];
    if (pathClear(path, obstacles)) return simplify(path);
  }
  // (d) 妥協: Z 字(中点)
  const cy = (fromA.y + toA.y) / 2;
  return simplify([fromA, { x: fromA.x, y: cy }, { x: toA.x, y: cy }, toA]);
}
