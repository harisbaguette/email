import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';
import postcss from 'postcss';

const root = process.cwd();
const failures = [];
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name),
      ),
    )
  ).flat();
}
function visit(node, check) {
  if (!node?.type) return;
  check(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, check));
    else if (value?.type) visit(value, check);
  }
}
for (const file of await files(join(root, 'src'))) {
  const name = relative(root, file);
  const source = await readFile(file, 'utf8');
  const report = (line, message) => failures.push(`${name}:${line} ${message}`);
  if (file.endsWith('.tsx') && !name.startsWith('src/ui/')) {
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    visit(ast, (node) => {
      if (node.type !== 'JSXOpeningElement') return;
      const tag = node.name.name;
      if (['button', 'input', 'select', 'textarea', 'dialog', 'details', 'summary'].includes(tag)) {
        report(node.loc.start.line, `<${tag}> 대신 src/ui의 공통 컴포넌트를 사용하세요.`);
      }
      for (const attr of node.attributes) {
        if (attr.type !== 'JSXAttribute') continue;
        if (
          attr.name.name === 'role' &&
          ['button', 'switch', 'checkbox', 'combobox', 'dialog', 'menuitem'].includes(
            attr.value?.value,
          )
        ) {
          report(
            attr.loc.start.line,
            'ARIA 역할로 조작 요소를 새로 만들지 말고 공통 컴포넌트를 사용하세요.',
          );
        }
        if (attr.name.name === 'style')
          report(attr.loc.start.line, '화면의 인라인 스타일 대신 디자인 토큰과 CSS를 사용하세요.');
        if (
          attr.name.name === 'className' &&
          /(?:primary-button|secondary-button|danger-button|icon-button|select-trigger|text-button|menu-item)/.test(
            source.slice(attr.start, attr.end),
          )
        ) {
          report(
            attr.loc.start.line,
            '공통 클래스 이름을 직접 지정하지 말고 variant 또는 전용 컴포넌트를 사용하세요.',
          );
        }
      }
      if (tag === 'IconButton' && !node.attributes.some((attr) => attr.name?.name === 'label'))
        report(node.loc.start.line, 'IconButton에는 label이 필요합니다.');
    });
  }
  if (file.endsWith('.css')) {
    const ast = postcss.parse(source, { from: file });
    const seen = new Set();
    ast.walkDecls((decl) => {
      if (
        !name.endsWith('ui/tokens.css') &&
        /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(decl.value)
      ) {
        report(decl.source.start.line, '색은 src/ui/tokens.css의 의미별 토큰으로 정의하세요.');
      }
      if (name.startsWith('src/ui/')) return;
      const selector = decl.parent.selector || '';
      if (
        /\.(?:icon-button|ui-button|primary-button|secondary-button|danger-button|text-button|select-trigger|ui-input|ui-checkbox)/.test(
          selector,
        ) &&
        !/^(?:margin(?:-.+)?|width|max-width|min-width|flex(?:-.+)?|align-self|position|top|right|bottom|left|grid(?:-.+)?)$/.test(
          decl.prop,
        )
      ) {
        report(decl.source.start.line, '화면 CSS에서 공통 컨트롤의 모양을 덮어쓸 수 없습니다.');
      }
    });
    ast.walkRules((rule) => {
      let scope = '';
      for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent)
        scope += `/${parent.name}:${parent.params}`;
      const key = scope + '/' + rule.selector;
      if (seen.has(key)) report(rule.source.start.line, `중복 규칙을 합치세요: ${rule.selector}`);
      seen.add(key);
    });
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('UI 검사 통과: 공통 컴포넌트, 색상 토큰, 스타일 소유권, 중복 규칙');
