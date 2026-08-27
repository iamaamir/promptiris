import type { Diagnostic, Phase } from '@meta-prompt/protocol';
import type { PluginContribution, PluginManifest } from '@meta-prompt/plugin-sdk';

/** @public */
export interface CompiledContribution {
  readonly pluginId: string;
  readonly contribution: PluginContribution;
}

/** @public */
export interface CompiledPluginGraph {
  readonly ok: boolean;
  readonly contributions: readonly CompiledContribution[];
  readonly diagnostics: readonly Diagnostic[];
}

type Constraint = 'before' | 'after' | 'requires';
type EdgeMap = Map<string, Set<string>>;

function requiredMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) throw new TypeError();
  return value;
}

const phases: readonly Phase[] = [
  'preflight',
  'analyze',
  'transform',
  'adapt',
  'validate',
  'render',
];
const phaseIndex = new Map(phases.map((phase, index) => [phase, index]));

function diagnostic(code: string, detail: string): Diagnostic {
  return Object.freeze({
    schemaVersion: '1',
    id: `diagnostic:${code}:${detail}`,
    code,
    category: 'plugin-graph',
    severity: 'error',
    title: code,
    detail,
  });
}

function freezeContribution(contribution: PluginContribution): PluginContribution {
  return Object.freeze({
    id: contribution.id,
    phase: contribution.phase,
    ...(contribution.requires === undefined
      ? {}
      : { requires: Object.freeze([...contribution.requires]) }),
    ...(contribution.before === undefined
      ? {}
      : { before: Object.freeze([...contribution.before]) }),
    ...(contribution.after === undefined ? {} : { after: Object.freeze([...contribution.after]) }),
    ...(contribution.conflicts === undefined
      ? {}
      : { conflicts: Object.freeze([...contribution.conflicts]) }),
  });
}

function selectPlugins(
  manifests: readonly PluginManifest[],
  selectedPluginIds: readonly string[],
  diagnostics: Diagnostic[],
): PluginManifest[] {
  const selected: PluginManifest[] = [];
  for (const id of new Set(selectedPluginIds)) {
    const matches = manifests.filter((manifest) => manifest.id === id);
    if (matches.length === 0) diagnostics.push(diagnostic('missing-selected-plugin', id));
    if (matches.length > 1) diagnostics.push(diagnostic('duplicate-plugin-id', id));
    const [manifest] = matches;
    // Stryker disable next-line ConditionalExpression: selecting the first duplicate cannot alter
    // the public result because duplicate-plugin-id already forces an empty executable plan.
    if (matches.length === 1 && manifest !== undefined) selected.push(manifest);
  }
  return selected;
}

function uniqueContributions(
  grouped: ReadonlyMap<string, readonly CompiledContribution[]>,
  diagnostics: Diagnostic[],
): Map<string, CompiledContribution> {
  const unique = new Map<string, CompiledContribution>();
  for (const [id, peers] of grouped) {
    if (peers.length > 1) diagnostics.push(diagnostic('duplicate-contribution-id', id));
    const [node] = peers;
    // Stryker disable next-line ConditionalExpression: retaining one duplicate cannot alter the
    // public result because duplicate-contribution-id already forces an empty executable plan.
    if (peers.length === 1 && node !== undefined) unique.set(id, node);
  }
  return unique;
}

function collectContributions(
  plugins: readonly PluginManifest[],
  diagnostics: Diagnostic[],
): Map<string, CompiledContribution> {
  const grouped = new Map<string, CompiledContribution[]>();
  for (const plugin of plugins) {
    for (const contribution of plugin.contributions ?? []) {
      const frozen = freezeContribution(contribution);
      const node = Object.freeze({ pluginId: plugin.id, contribution: frozen });
      grouped.set(contribution.id, [...(grouped.get(contribution.id) ?? []), node]);
      if (!phaseIndex.has(contribution.phase)) {
        diagnostics.push(diagnostic('unknown-phase', `${contribution.id}:${contribution.phase}`));
      }
    }
  }
  return uniqueContributions(grouped, diagnostics);
}

function phaseRank(node: CompiledContribution): number | undefined {
  return phaseIndex.get(node.contribution.phase);
}

function isReversed(
  from: CompiledContribution,
  target: CompiledContribution,
  constraint: Constraint,
): boolean {
  const fromRank = phaseRank(from);
  const targetRank = phaseRank(target);
  if (fromRank === undefined || targetRank === undefined) return false;
  return constraint === 'before' ? fromRank > targetRank : targetRank > fromRank;
}

function addReference(
  edges: EdgeMap,
  nodes: ReadonlyMap<string, CompiledContribution>,
  from: CompiledContribution,
  targetId: string,
  constraint: Constraint,
  diagnostics: Diagnostic[],
): void {
  const target = nodes.get(targetId);
  if (target === undefined) {
    diagnostics.push(
      diagnostic('missing-referenced-contribution', `${from.contribution.id}:${targetId}`),
    );
    return;
  }
  if (isReversed(from, target, constraint)) {
    diagnostics.push(
      diagnostic('reversed-cross-phase-edge', `${from.contribution.id}:${targetId}`),
    );
    return;
  }
  const [sourceId, destinationId] =
    constraint === 'before' ? [from.contribution.id, targetId] : [targetId, from.contribution.id];
  edges.get(sourceId)?.add(destinationId);
}

function addConstraints(
  node: CompiledContribution,
  nodes: ReadonlyMap<string, CompiledContribution>,
  edges: EdgeMap,
  diagnostics: Diagnostic[],
): void {
  for (const id of node.contribution.requires ?? [])
    addReference(edges, nodes, node, id, 'requires', diagnostics);
  for (const id of node.contribution.before ?? [])
    addReference(edges, nodes, node, id, 'before', diagnostics);
  for (const id of node.contribution.after ?? [])
    addReference(edges, nodes, node, id, 'after', diagnostics);
}

function buildEdges(
  nodes: ReadonlyMap<string, CompiledContribution>,
  selectedPluginIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): EdgeMap {
  const edges: EdgeMap = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const node of nodes.values()) {
    addConstraints(node, nodes, edges, diagnostics);
    for (const id of node.contribution.conflicts ?? []) {
      if (nodes.has(id) || selectedPluginIds.has(id)) {
        diagnostics.push(diagnostic('selected-conflict', `${node.contribution.id}:${id}`));
      }
    }
  }
  return edges;
}

function readyNodes(
  nodes: ReadonlyMap<string, CompiledContribution>,
  indegree: ReadonlyMap<string, number>,
  visited: ReadonlySet<string>,
): CompiledContribution[] {
  return [...nodes.values()]
    .filter((node) => {
      const id = node.contribution.id;
      return indegree.get(id) === 0 && !visited.has(id);
    })
    .sort((left, right) => {
      const leftRank = phaseRank(left) ?? phases.length;
      const rightRank = phaseRank(right) ?? phases.length;
      return leftRank - rightRank || left.contribution.id.localeCompare(right.contribution.id);
    });
}

function topologicalOrder(
  nodes: ReadonlyMap<string, CompiledContribution>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  diagnostics: Diagnostic[],
): CompiledContribution[] {
  const indegree = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (const targets of edges.values()) {
    for (const target of targets) {
      indegree.set(target, requiredMapValue(indegree, target) + 1);
    }
  }
  const order: CompiledContribution[] = [];
  const visited = new Set<string>();
  while (order.length < nodes.size) {
    const [next] = readyNodes(nodes, indegree, visited);
    if (next === undefined) {
      const remaining = [...nodes.keys()].filter((id) => !visited.has(id)).sort();
      diagnostics.push(diagnostic('cycle', remaining.join(',')));
      return [];
    }
    order.push(next);
    const nextId = next.contribution.id;
    visited.add(nextId);
    for (const target of requiredMapValue(edges, nextId)) {
      indegree.set(target, requiredMapValue(indegree, target) - 1);
    }
  }
  return order;
}

function normalizedDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const unique = new Map(diagnostics.map((item) => [item.id, item]));
  return Object.freeze(
    [...unique.values()].sort(
      (left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id),
    ),
  );
}

/** @public */
export function compilePluginGraph(
  manifests: readonly PluginManifest[],
  selectedPluginIds: readonly string[],
): CompiledPluginGraph {
  const diagnostics: Diagnostic[] = [];
  const plugins = selectPlugins(manifests, selectedPluginIds, diagnostics);
  const nodes = collectContributions(plugins, diagnostics);
  const edges = buildEdges(nodes, new Set(selectedPluginIds), diagnostics);
  const order = topologicalOrder(nodes, edges, diagnostics);
  const finalDiagnostics = normalizedDiagnostics(diagnostics);
  return Object.freeze({
    ok: finalDiagnostics.length === 0,
    contributions: finalDiagnostics.length === 0 ? Object.freeze(order) : Object.freeze([]),
    diagnostics: finalDiagnostics,
  });
}
