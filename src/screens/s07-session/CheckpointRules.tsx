import { compareCheckpointRules } from "../../domain/checkpointRulesModel.ts";
import type { Checkpoint, RuleSet } from "../../domain/types.ts";

export function CheckpointRules({ checkpoint, current }: { readonly checkpoint: Checkpoint; readonly current: RuleSet }) {
  const snapshot = checkpoint.rulesSnapshot;
  if (!snapshot) return <p className="s07-note" data-checkpoint-rules="legacy-unknown">旧检查点没有保存规则快照，无法证明当时规则。不会用当前规则补写历史。</p>;
  const differences = compareCheckpointRules(snapshot, current);
  return <section className="s07-notes" aria-label="检查点规则对照">
    <h4>检查点规则对照</h4>
    <p className="s07-note">保存时规则 r{snapshot.revision} · 当前规则 r{current.revision}。只比较已记录的授权、自动化开关、每日容量和时区；不会自动恢复旧规则。</p>
    {differences.length ? <table>
      <thead><tr><th>规则</th><th>保存时</th><th>当前</th></tr></thead>
      <tbody>{differences.map(change => <tr key={change.label}><th scope="row">{change.label}</th><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody>
    </table> : <p className="s07-note" data-checkpoint-rules="unchanged">所记录的规则字段与当前一致。</p>}
  </section>;
}
