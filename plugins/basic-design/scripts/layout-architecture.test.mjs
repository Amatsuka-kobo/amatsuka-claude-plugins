import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutArchitecture } from './lib/layout/architecture.mjs';
import { rectsOverlap } from './test-helpers.mjs';

const spec = () => ({
  type: 'architecture',
  title: 'Web システム構成',
  zones: [
    { id: 'aws', label: 'AWS', children: ['alb', 'app', 'db'] },
    { id: 'monitor', label: '監視', children: ['grafana'] },
  ],
  nodes: [
    { id: 'browser', label: 'ブラウザ' },
    { id: 'alb', label: 'ALB' },
    { id: 'app', label: 'App Server', icon: 'server' },
    { id: 'db', label: 'DB' },
    { id: 'grafana', label: 'Grafana' },
  ],
  edges: [
    { from: 'browser', to: 'alb', label: 'HTTPS' },
    { from: 'alb', to: 'app', label: 'HTTP' },
    { from: 'app', to: 'db', label: 'SQL' },
  ],
});

test('ゾーンが左から並び、子ノードはゾーンの矩形内に収まる', () => {
  const layout = layoutArchitecture(spec());
  assert.equal(layout.zones.length, 2);
  const [aws, monitor] = layout.zones;
  assert.ok(aws.x + aws.width < monitor.x + monitor.width);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const id of ['alb', 'app', 'db']) {
    const n = byId.get(id);
    assert.ok(n.x >= aws.x && n.x + n.width <= aws.x + aws.width, `${id} が AWS ゾーン外(x)`);
    assert.ok(n.y >= aws.y && n.y + n.height <= aws.y + aws.height, `${id} が AWS ゾーン外(y)`);
  }
});

test('ゾーン外のノードはどのゾーン矩形とも重ならない', () => {
  const layout = layoutArchitecture(spec());
  const browser = layout.nodes.find((n) => n.id === 'browser');
  for (const zone of layout.zones) {
    assert.ok(!rectsOverlap(browser, zone), `browser が ${zone.id} と重なっています`);
  }
});

test('どのノードのペアも重ならない', () => {
  const layout = layoutArchitecture(spec());
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      assert.ok(!rectsOverlap(layout.nodes[i], layout.nodes[j]));
    }
  }
});

test('ゾーン同士も重ならない', () => {
  const layout = layoutArchitecture(spec());
  assert.ok(!rectsOverlap(layout.zones[0], layout.zones[1]));
});

test('meta に icon と zone が入る', () => {
  const layout = layoutArchitecture(spec());
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId.get('app').meta, { icon: 'server', zone: 'aws' });
  assert.deepEqual(byId.get('browser').meta, { icon: '', zone: '' });
});

test('zones 省略時はゾーンなしの全ノードグリッド', () => {
  const s = spec();
  delete s.zones;
  const layout = layoutArchitecture(s);
  assert.deepEqual(layout.zones, []);
  assert.equal(layout.nodes.length, 5);
});

test('エッジが順に採番される', () => {
  const layout = layoutArchitecture(spec());
  assert.deepEqual(layout.edges[0], { id: 'e1', from: 'browser', to: 'alb', label: 'HTTPS', style: 'arrow' });
});
