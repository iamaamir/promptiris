import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { discoverWorkspaceCoverage } from '../tooling/quality/coverage-reports.mjs';

const reports = await discoverWorkspaceCoverage(resolve('.'));
if (reports.length === 0)
  throw new Error('coverage-final.json not found; run pnpm test:coverage first');

const results = [];
function complexity(node) {
  let score = 1;
  function visit(child) {
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isCaseClause(child) ||
      ts.isCatchClause(child) ||
      ts.isConditionalExpression(child)
    )
      score++;
    if (
      ts.isBinaryExpression(child) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(child.operatorToken.kind)
    )
      score++;
    ts.forEachChild(child, visit);
  }
  ts.forEachChild(node, visit);
  return score;
}

for (const report of reports) {
  const coverage = JSON.parse(await readFile(report, 'utf8'));
  for (const [sourcePath, data] of Object.entries(coverage)) {
    if (!sourcePath.endsWith('.ts')) continue;
    const source = ts.createSourceFile(
      sourcePath,
      await readFile(sourcePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function inspect(node) {
      if (ts.isFunctionLike(node) && node.body) {
        const start = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const end = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        const statements = Object.entries(data.statementMap).filter(
          ([, location]) => location.start.line >= start && location.end.line <= end,
        );
        const covered = statements.filter(([id]) => data.s[id] > 0).length;
        const ratio = statements.length === 0 ? 1 : covered / statements.length;
        const cyclomatic = complexity(node);
        const crap = cyclomatic ** 2 * (1 - ratio) ** 3 + cyclomatic;
        results.push({
          file: relative('.', sourcePath),
          line: start,
          complexity: cyclomatic,
          coverage: Number((ratio * 100).toFixed(2)),
          crap: Number(crap.toFixed(2)),
        });
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
}
results.sort((a, b) => b.crap - a.crap);
const violations = results.filter(
  (item) =>
    item.crap >
    (item.file.includes('packages/protocol') || item.file.includes('packages/core') ? 15 : 30),
);
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  thresholds: { protocolAndCore: 15, default: 30 },
  functions: results,
  violations,
};
await mkdir(resolve('.agent/reports'), { recursive: true });
await writeFile(resolve('.agent/reports/crap.json'), `${JSON.stringify(report, null, 2)}\n`);
const maximum = results.at(0);
console.log(
  `CRAP ${violations.length === 0 ? 'passed' : 'failed'}: ${results.length} functions, ${violations.length} violations, max ${maximum?.crap ?? 0} at ${maximum?.file ?? 'none'}:${maximum?.line ?? 0}`,
);
if (violations.length > 0) process.exitCode = 1;
