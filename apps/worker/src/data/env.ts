import type { Env } from "../env";

export interface DataEnv extends Env {
  DB: WorkerBindings["DB"];
  R2: WorkerBindings["R2"];
}
