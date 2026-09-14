import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLibraryMarkdown } from './library-markdown.js';

test('知识库 Markdown 输出公式和 Mermaid 占位符', () => {
  const rendered = renderLibraryMarkdown([
    '# 渲染测试',
    '',
    '内联公式：\\(f=ma\\)。',
    '',
    '\\[',
    'AI \\rightarrow 生产率提高',
    '\\]',
    '',
    '```mermaid',
    'flowchart TD',
    '    A[开始] --> B{判断}',
    '    B -->|是| C[结束]',
    '```',
  ].join('\n'));

  assert.match(rendered, /class="library-math library-math-inline" data-library-math="inline"/);
  assert.match(rendered, /class="library-math library-math-display" data-library-math="display"/);
  assert.match(rendered, /class="library-mermaid" data-library-mermaid="true"/);
  assert.match(rendered, /AI \\rightarrow 生产率提高/);
  assert.doesNotMatch(rendered, /<pre><code[^>]*>flowchart TD/);
  assert.doesNotMatch(rendered, /<p>\\\[/);
});

test('知识库可识别未标注语言的 flowchart 源码', () => {
  const rendered = renderLibraryMarkdown([
    '```',
    'flowchart LR',
    '    A[输入] --> B[输出]',
    '```',
  ].join('\n'));

  assert.match(rendered, /class="library-mermaid" data-library-mermaid="true"/);
});

test('知识库仍会转义富内容源码和危险 HTML', () => {
  const rendered = renderLibraryMarkdown([
    '\\[',
    '<script>alert(1)</script>',
    '\\]',
    '',
    '```mermaid',
    'flowchart TD',
    '    A["<script>"] --> B[安全]',
    '```',
  ].join('\n'));

  assert.match(rendered, /&lt;script&gt;/);
  assert.doesNotMatch(rendered, /<script>/);
});
