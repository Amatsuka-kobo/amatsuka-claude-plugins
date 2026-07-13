import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeOrthogonal } from './lib/route.mjs';

const MARGIN = 12;

// 全セグメントが水平または垂直であることを検証
function assertAxisAligned(points) {
  assert.ok(points.length >= 2, 'points >= 2');
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const horizontal = a.y === b.y;
    const vertical = a.x === b.x;
    assert.ok(
      horizontal || vertical,
      `segment ${i} が水平でも垂直でもない: (${a.x},${a.y})->(${b.x},${b.y})`,
    );
  }
}

// あるセグメントが MARGIN 膨張した矩形と交差しないか(端点接触は非交差)
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

function assertClearOf(points, rect) {
  for (let i = 0; i < points.length - 1; i++) {
    assert.ok(
      !segHitsRect(points[i], points[i + 1], rect),
      `segment ${i} が障害物と交差した`,
    );
  }
}

function pointInsideRect(point, rect) {
  return (
    rect.x < point.x &&
    point.x < rect.x + rect.width &&
    rect.y < point.y &&
    point.y < rect.y + rect.height
  );
}

function segHitsRectInterior(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    minX < rect.x + rect.width &&
    rect.x < maxX &&
    minY < rect.y + rect.height &&
    rect.y < maxY
  );
}

function assertClearOfNodeInteriors(points, ...nodes) {
  for (let i = 0; i < points.length - 1; i++) {
    for (const node of nodes) {
      assert.ok(
        !segHitsRectInterior(points[i], points[i + 1], node),
        `segment ${i} が自ノード内部と交差した`,
      );
    }
  }
}

test('整列した2ノード・障害物なし → 2点(アンカーが辺上)', () => {
  const from = { x: 0, y: 0, width: 100, height: 60 };
  const to = { x: 300, y: 0, width: 100, height: 60 };
  const pts = routeOrthogonal(from, to, []);
  assert.equal(pts.length, 2);
  assertAxisAligned(pts);
  // アンカーは対面する辺の中点
  assert.deepEqual(pts[0], { x: 100, y: 30 }); // from 右辺中点
  assert.deepEqual(pts[1], { x: 300, y: 30 }); // to 左辺中点
});

test('間に障害物 → 全セグメントが障害物を避け、点数 >= 3', () => {
  const from = { x: 0, y: 0, width: 100, height: 60 };
  const to = { x: 400, y: 40, width: 100, height: 60 };
  // from(y 0..60) と to(y 40..100) の両方に跨る高さの障害物を中央に置く
  const obstacle = { x: 200, y: 0, width: 100, height: 100 };
  const pts = routeOrthogonal(from, to, [obstacle]);
  assertAxisAligned(pts);
  assert.ok(pts.length >= 3, `点数 ${pts.length} >= 3`);
  assertClearOf(pts, obstacle);
});

test('逆方向(to が from の左)でも障害物を避ける', () => {
  const from = { x: 400, y: 0, width: 100, height: 60 };
  const to = { x: 0, y: 40, width: 100, height: 60 };
  const obstacle = { x: 200, y: 0, width: 100, height: 100 };
  const pts = routeOrthogonal(from, to, [obstacle]);
  assertAxisAligned(pts);
  assert.ok(pts.length >= 3);
  assertClearOf(pts, obstacle);
});

test('縦方向主体でも障害物を避ける', () => {
  const from = { x: 0, y: 0, width: 60, height: 100 };
  const to = { x: 40, y: 400, width: 60, height: 100 };
  // from(x 0..60) と to(x 40..100) の両方に跨る幅の障害物を中央に
  const obstacle = { x: 0, y: 200, width: 100, height: 100 };
  const pts = routeOrthogonal(from, to, [obstacle]);
  assertAxisAligned(pts);
  assert.ok(pts.length >= 3);
  assertClearOf(pts, obstacle);
});

test('直線経路上の障害物は迂回する(整列ケースでも避ける)', () => {
  const from = { x: 0, y: 0, width: 100, height: 60 };
  const to = { x: 400, y: 0, width: 100, height: 60 };
  // 直線 y=30 を塞ぐ障害物
  const blocking = { x: 200, y: 0, width: 60, height: 60 };
  const pts = routeOrthogonal(from, to, [blocking]);
  assertAxisAligned(pts);
  assert.ok(pts.length >= 3);
  assertClearOf(pts, blocking);
});

test('支配軸の投影が重なる場合も自ノード矩形を貫通しない', () => {
  const from = { x: 0, y: 0, width: 300, height: 60 };
  const to = { x: 250, y: 100, width: 300, height: 60 };
  const pts = routeOrthogonal(from, to, []);

  assertAxisAligned(pts);
  assertClearOfNodeInteriors(pts, from, to);
  for (const point of pts.slice(1, -1)) {
    assert.ok(!pointInsideRect(point, from));
    assert.ok(!pointInsideRect(point, to));
  }
});

test('決定的グリッド全組み合わせで直交し中間点が自ノード内部に入らない', () => {
  const coordinates = [-400, -240, -120, 0, 120, 240, 400];
  const dimensions = [
    { width: 60, height: 40 },
    { width: 120, height: 80 },
    { width: 300, height: 60 },
  ];
  let cases = 0;

  for (const fromSize of dimensions) {
    const from = { x: 0, y: 0, ...fromSize };
    for (const toSize of dimensions) {
      for (const x of coordinates) {
        for (const y of coordinates) {
          const to = { x, y, ...toSize };
          const overlaps =
            from.x < to.x + to.width &&
            to.x < from.x + from.width &&
            from.y < to.y + to.height &&
            to.y < from.y + from.height;
          if (overlaps) continue;

          const pts = routeOrthogonal(from, to, []);
          assertAxisAligned(pts);
          assertClearOfNodeInteriors(pts, from, to);
          for (const point of pts.slice(1, -1)) {
            assert.ok(
              !pointInsideRect(point, from) && !pointInsideRect(point, to),
              `中間点 (${point.x},${point.y}) が自ノード内部にある`,
            );
          }
          cases++;
        }
      }
    }
  }

  assert.ok(cases >= 300, `検証ケース数 ${cases} >= 300`);
});
