import { useState } from "react";
import { api, type JsonValue, type ReferenceSet } from "./api";

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}
type AdminReferencesOptions = {
  refresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};
export function useAdminReferences({ refresh, onError, onNotice }: AdminReferencesOptions) {
  const [sets, setSets] = useState<ReferenceSet[]>([]);
  const [setId, setSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [setVersion, setSetVersion] = useState("");
  const [setItems, setSetItems] = useState("[]");
  const [newSetName, setNewSetName] = useState("");
  const [newSetVersion, setNewSetVersion] = useState("1");
  function selectSet(id: string): void {
    const set = sets.find((item) => item.id === id);
    if (!set) return;
    const version = set.versions[0];
    setSetId(id);
    setSetName(set.name);
    setSetDescription(set.description ?? "");
    setSetVersion(version?.label ?? "");
    setSetItems(
      JSON.stringify(
        version?.items?.map((item) => ({
          kind: item.kind,
          displayName: item.displayName,
          exactHash: item.exactHash,
          normalizedContentHash: item.normalizedContentHash,
          nameHash: item.nameHash,
          structureHash: item.structureHash,
        })) ?? [],
        null,
        2,
      ),
    );
  }
  async function saveSet(): Promise<void> {
    if (!setId) return;
    try {
      const parsedItems: unknown = parseJson(setItems);
      if (!Array.isArray(parsedItems)) throw new Error("items 必须是 JSON 数组");
      await api.updateReferenceSet(setId, {
        name: setName,
        description: setDescription || null,
        versionLabel: setVersion,
        items: parsedItems,
      });
      onNotice("基线已保存。");
      await refresh();
    } catch (value) {
      onError(`基线保存失败：${String(value)}`);
    }
  }

  async function createSet(): Promise<void> {
    if (!newSetName.trim() || !newSetVersion.trim()) return;
    try {
      await api.createReferenceSet({ name: newSetName.trim(), versionLabel: newSetVersion.trim() });
      setNewSetName("");
      onNotice("基线已创建。");
      await refresh();
    } catch (value) {
      onError(`基线创建失败：${String(value)}`);
    }
  }

  async function createVersion(): Promise<void> {
    if (!setId || !setVersion.trim()) return;
    try {
      await api.createReferenceVersion(setId, { versionLabel: setVersion.trim() });
      onNotice("新基线版本已创建。");
      await refresh();
    } catch (value) {
      onError(`版本创建失败：${String(value)}`);
    }
  }
  return {
    setSets,
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
  };
}
