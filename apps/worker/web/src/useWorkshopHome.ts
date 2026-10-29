import { useEffect, useRef, useState } from "react";
import { api, type HomeResponse } from "./api";

export type HomeLoadState =
  | { status: "loading" }
  | { status: "ready"; data: HomeResponse }
  | { status: "error"; error: unknown };

export function useWorkshopHome(): HomeLoadState {
  const [state, setState] = useState<HomeLoadState>({ status: "loading" });
  const request = useRef<Promise<HomeResponse> | null>(null);
  useEffect(() => {
    let active = true;
    request.current ??= api.home();
    request.current.then(
      (data) => {
        if (active) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (active) setState({ status: "error", error });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
