import { useCallback, useRef, useState } from "react";
import { fileKey, loadRegexAsset, loadWorldbookAsset, type RegexAsset, type WorldbookAsset } from "./preview";

export function useDraftAssetSelection(workingRevisionFrozen: boolean, onNotice: (message: string) => void) {
  const [worldbook, setWorldbook] = useState<WorldbookAsset | null>(null);
  const [regexAssets, setRegexAssets] = useState<RegexAsset[]>([]);
  const [worldbookError, setWorldbookError] = useState<string | null>(null);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [worldbookUploaded, setWorldbookUploaded] = useState(false);
  const [regexUploaded, setRegexUploaded] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [parsingAssets, setParsingAssets] = useState(0);
  const assetGeneration = useRef(0);
  const selectionVersion = useRef(0);
  const regexAssetsRef = useRef<RegexAsset[]>([]);
  const regexParseChain = useRef<Promise<void>>(Promise.resolve());
  const worldbookPick = useRef(0);

  function pickWorldbook(files: FileList): void {
    const file = files[0];
    if (!file || workingRevisionFrozen) return;
    const generation = assetGeneration.current;
    const pick = worldbookPick.current + 1;
    worldbookPick.current = pick;
    setParsingAssets((value) => value + 1);
    setWorldbookError(null);
    setSubmitNotice(null);
    void loadWorldbookAsset(file)
      .then((result) => {
        if (generation !== assetGeneration.current || pick !== worldbookPick.current) return;
        if (!result.ok) {
          setWorldbookError(result.error);
          return;
        }
        setWorldbook(result.value);
        setWorldbookUploaded(false);
        selectionVersion.current += 1;
      })
      .finally(() => {
        if (generation === assetGeneration.current) setParsingAssets((value) => value - 1);
      });
  }

  function pickRegex(files: FileList): void {
    const incoming = Array.from(files);
    if (incoming.length === 0 || workingRevisionFrozen) return;
    const generation = assetGeneration.current;
    setParsingAssets((value) => value + 1);
    setRegexError(null);
    setSubmitNotice(null);
    regexParseChain.current = regexParseChain.current
      .then(async () => {
        const results = await Promise.all(incoming.map((file) => loadRegexAsset(file)));
        if (generation !== assetGeneration.current) return;
        const errors = results.flatMap((result) => (result.ok ? [] : [result.error]));
        const loaded = results.flatMap((result) => (result.ok ? [result.value] : []));
        if (errors.length > 0) setRegexError(errors.join(" "));
        if (loaded.length === 0) return;
        const keys = new Set(regexAssetsRef.current.map((asset) => fileKey(asset.file)));
        const additions: RegexAsset[] = [];
        let duplicates = 0;
        for (const asset of loaded) {
          const key = fileKey(asset.file);
          if (keys.has(key)) {
            duplicates += 1;
            continue;
          }
          keys.add(key);
          additions.push(asset);
        }
        if (duplicates > 0) onNotice(`${duplicates} 个文件与已选文件重复，已忽略。`);
        if (additions.length > 0) {
          const next = [...regexAssetsRef.current, ...additions];
          regexAssetsRef.current = next;
          setRegexAssets(next);
          setRegexUploaded(false);
          selectionVersion.current += 1;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (generation === assetGeneration.current) setParsingAssets((value) => value - 1);
      });
  }

  function removeWorldbook(): void {
    setWorldbook(null);
    setWorldbookError(null);
    setWorldbookUploaded(false);
    setSubmitNotice(null);
    selectionVersion.current += 1;
  }

  function removeRegex(index: number): void {
    const next = regexAssetsRef.current.filter((_, position) => position !== index);
    regexAssetsRef.current = next;
    setRegexAssets(next);
    setRegexUploaded(false);
    setSubmitNotice(null);
    selectionVersion.current += 1;
  }

  const reset = useCallback(() => {
    assetGeneration.current += 1;
    selectionVersion.current += 1;
    setParsingAssets(0);
    setWorldbook(null);
    regexAssetsRef.current = [];
    setRegexAssets([]);
    setWorldbookError(null);
    setRegexError(null);
    setWorldbookUploaded(false);
    setRegexUploaded(false);
    setSubmitNotice(null);
  }, []);

  return {
    reset,
    worldbook,
    setWorldbook,
    regexAssets,
    setRegexAssets,
    worldbookError,
    setWorldbookError,
    regexError,
    setRegexError,
    worldbookUploaded,
    setWorldbookUploaded,
    regexUploaded,
    setRegexUploaded,
    submitNotice,
    setSubmitNotice,
    parsingAssets,
    setParsingAssets,
    assetGeneration,
    selectionVersion,
    regexAssetsRef,
    pickWorldbook,
    pickRegex,
    removeWorldbook,
    removeRegex,
  };
}
