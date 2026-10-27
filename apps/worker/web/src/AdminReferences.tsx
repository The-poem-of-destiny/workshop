import type { useAdminData } from "./useAdminData";

export function AdminReferences({
  busy,
  refresh,
  newSetName,
  setNewSetName,
  newSetVersion,
  setNewSetVersion,
  createSet,
  setId,
  selectSet,
  sets,
  setName,
  setSetName,
  setVersion,
  setSetVersion,
  setDescription,
  setSetDescription,
  setItems,
  setSetItems,
  saveSet,
  createVersion,
}: {
  busy: ReturnType<typeof useAdminData>["busy"];
  refresh: ReturnType<typeof useAdminData>["refresh"];
  newSetName: ReturnType<typeof useAdminData>["newSetName"];
  setNewSetName: ReturnType<typeof useAdminData>["setNewSetName"];
  newSetVersion: ReturnType<typeof useAdminData>["newSetVersion"];
  setNewSetVersion: ReturnType<typeof useAdminData>["setNewSetVersion"];
  createSet: ReturnType<typeof useAdminData>["createSet"];
  setId: ReturnType<typeof useAdminData>["setId"];
  selectSet: ReturnType<typeof useAdminData>["selectSet"];
  sets: ReturnType<typeof useAdminData>["sets"];
  setName: ReturnType<typeof useAdminData>["setName"];
  setSetName: ReturnType<typeof useAdminData>["setSetName"];
  setVersion: ReturnType<typeof useAdminData>["setVersion"];
  setSetVersion: ReturnType<typeof useAdminData>["setSetVersion"];
  setDescription: ReturnType<typeof useAdminData>["setDescription"];
  setSetDescription: ReturnType<typeof useAdminData>["setSetDescription"];
  setItems: ReturnType<typeof useAdminData>["setItems"];
  setSetItems: ReturnType<typeof useAdminData>["setSetItems"];
  saveSet: ReturnType<typeof useAdminData>["saveSet"];
  createVersion: ReturnType<typeof useAdminData>["createVersion"];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>角色基线</h2>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      <div className="form-grid">
        <label>
          新参考集名称
          <input value={newSetName} onChange={(event) => setNewSetName(event.target.value)} />
        </label>
        <label>
          初始版本
          <input value={newSetVersion} onChange={(event) => setNewSetVersion(event.target.value)} />
        </label>
      </div>
      <button type="button" onClick={() => void createSet()}>
        创建参考集
      </button>
      <label>
        参考集
        <select value={setId} onChange={(event) => selectSet(event.target.value)}>
          <option value="">选择参考集</option>
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </select>
      </label>
      {setId ? (
        <>
          <div className="form-grid">
            <label>
              名称
              <input value={setName} onChange={(event) => setSetName(event.target.value)} />
            </label>
            <label>
              版本标签
              <input value={setVersion} onChange={(event) => setSetVersion(event.target.value)} />
            </label>
          </div>
          <label>
            说明
            <textarea value={setDescription} onChange={(event) => setSetDescription(event.target.value)} />
          </label>
          <label>
            items JSON
            <textarea value={setItems} onChange={(event) => setSetItems(event.target.value)} rows={10} />
          </label>
          <div className="button-row">
            <button type="button" className="primary" onClick={() => void saveSet()}>
              保存基线
            </button>
            <button type="button" onClick={() => void createVersion()}>
              用当前版本号新建版本
            </button>
          </div>
        </>
      ) : (
        <p className="hint">选择参考集后编辑名称、版本和 items；items 全量替换。</p>
      )}
    </section>
  );
}
