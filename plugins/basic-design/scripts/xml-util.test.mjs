import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml } from './lib/xml-util.mjs';

test('escapeXml: XML 特殊文字 5 種をすべてエスケープする', () => {
  assert.equal(
    escapeXml(`<a & "b" 'c'>`),
    '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;',
  );
});

test('escapeXml: 特殊文字を含まない文字列はそのまま返す', () => {
  assert.equal(escapeXml('users テーブル'), 'users テーブル');
});

test('escapeXml: 非文字列は文字列化して処理する', () => {
  assert.equal(escapeXml(123), '123');
});
