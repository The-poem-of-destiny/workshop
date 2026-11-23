import { MaintenanceUnavailableError, markWriteUncertain, withWriteBarrier } from "../write-barrier";
import type { DataEnv } from "./env";

const guardedBuckets = new WeakMap<R2Bucket, { env: DataEnv; raw: R2Bucket }>();

export async function runGuardedStagedUpload<T>(
  bucket: R2Bucket,
  key: string,
  uploadAndPipe: (raw: R2Bucket) => {
    pipe: Promise<void>;
    upload: Promise<R2Object | null>;
    abort: (reason?: unknown) => void;
    result: () => T;
  },
): Promise<T> {
  const entry = guardedBuckets.get(bucket);
  if (!entry) {
    const task = uploadAndPipe(bucket);
    try {
      const [, stored] = await Promise.all([task.pipe, task.upload]);
      if (!stored) throw new Error("Staging upload was not stored");
      return task.result();
    } catch (error) {
      task.abort(error);
      await Promise.allSettled([task.pipe, task.upload]);
      await bucket.delete(key);
      throw error;
    }
  }
  const { env, raw } = entry;
  const barrierResult = await withWriteBarrier(env, "r2.stage", async () => {
    const task = uploadAndPipe(raw);
    try {
      const [, stored] = await Promise.all([task.pipe, task.upload]);
      if (!stored) throw new Error("Staging upload was not stored");
      return { ok: true as const, value: task.result() };
    } catch (error) {
      task.abort(error);
      await Promise.allSettled([task.pipe, task.upload]);
      try {
        await raw.delete(key);
      } catch (cleanupError) {
        markWriteUncertain(cleanupError);
        throw cleanupError;
      }
      return { ok: false as const, error };
    }
  });
  if (!barrierResult.admitted) throw new MaintenanceUnavailableError();
  if (!barrierResult.value.ok) throw barrierResult.value.error;
  return barrierResult.value.value;
}

export function guardedStorageEnv(env: DataEnv): DataEnv {
  const statements = new WeakMap<object, { target: object; readOnly: boolean }>();

  function invoke<T>(target: object, property: PropertyKey, args: unknown[]): T {
    return Reflect.apply(Reflect.get(target, property, target) as (...args: unknown[]) => T, target, args);
  }

  async function guarded<T>(kind: string, operation: () => Promise<T>): Promise<T> {
    const result = await withWriteBarrier(env, kind, async () => {
      try {
        return await operation();
      } catch (error) {
        markWriteUncertain(error);
        throw error;
      }
    });
    if (!result.admitted) throw new MaintenanceUnavailableError();
    return result.value;
  }

  function statement<T extends object>(target: T, readOnly: boolean): T {
    const proxy = new Proxy(target, {
      get(object, property) {
        if (property === "bind") {
          return (...args: unknown[]) => statement(invoke<object>(object, property, args), readOnly);
        }
        if (property === "first" || property === "all" || property === "run" || property === "raw") {
          return (...args: unknown[]) => {
            const execute = () => invoke<Promise<unknown>>(object, property, args);
            return readOnly ? execute() : guarded(`d1.${property}`, execute);
          };
        }
        const value = Reflect.get(object, property, object);
        if (typeof value === "function") throw new Error(`Unsupported D1 statement method: ${String(property)}`);
        return value;
      },
    });
    statements.set(proxy, { target, readOnly });
    return proxy;
  }

  function database<T extends object>(target: T): T {
    return new Proxy(target, {
      get(object, property) {
        if (property === "prepare") {
          return (...args: unknown[]) => {
            const sql = args[0];
            const readOnly = typeof sql === "string" && /^\s*select\b[^;]*;?\s*$/i.test(sql);
            return statement(invoke<object>(object, property, args), readOnly);
          };
        }
        if (property === "withSession") {
          return (...args: unknown[]) => database(invoke<object>(object, property, args));
        }
        if (property === "batch") {
          return (batch: object[]) => {
            let readOnly = true;
            const unwrapped = batch.map((item) => {
              const original = statements.get(item);
              if (!original) throw new Error("D1 batch contains an unguarded statement");
              readOnly &&= original.readOnly;
              return original.target;
            });
            const execute = () => invoke<Promise<unknown>>(object, property, [unwrapped]);
            return readOnly ? execute() : guarded("d1.batch", execute);
          };
        }
        if (property === "exec" || property === "dump") {
          return (...args: unknown[]) =>
            guarded(`d1.${property}`, () => invoke<Promise<unknown>>(object, property, args));
        }
        if (property === "getBookmark") {
          return (...args: unknown[]) => invoke<unknown>(object, property, args);
        }
        const value = Reflect.get(object, property, object);
        if (typeof value === "function") throw new Error(`Unsupported D1 method: ${String(property)}`);
        return value;
      },
    });
  }

  function multipart<T extends object>(target: T): T {
    return new Proxy(target, {
      get(object, property) {
        if (property === "uploadPart" || property === "complete" || property === "abort") {
          return (...args: unknown[]) =>
            guarded(`r2.multipart.${property}`, () => invoke<Promise<unknown>>(object, property, args));
        }
        const value = Reflect.get(object, property, object);
        if (typeof value === "function") throw new Error(`Unsupported R2 multipart method: ${String(property)}`);
        return value;
      },
    });
  }

  const bucket = (target: R2Bucket) => {
    const proxy = new Proxy(target, {
      get(object, property) {
        if (property === "put" || property === "delete") {
          return (...args: unknown[]) =>
            guarded(`r2.${property}`, () => invoke<Promise<unknown>>(object, property, args));
        }
        if (property === "createMultipartUpload") {
          return (...args: unknown[]) =>
            guarded("r2.createMultipartUpload", async () =>
              multipart(await invoke<Promise<object>>(object, property, args)),
            );
        }
        if (property === "resumeMultipartUpload") {
          return (...args: unknown[]) => multipart(invoke<object>(object, property, args));
        }
        if (property === "get" || property === "head" || property === "list") {
          return (...args: unknown[]) => invoke<unknown>(object, property, args);
        }
        const value = Reflect.get(object, property, object);
        if (typeof value === "function") throw new Error(`Unsupported R2 method: ${String(property)}`);
        return value;
      },
    });
    guardedBuckets.set(proxy, { env, raw: target });
    return proxy;
  };

  return Object.defineProperties(Object.create(env), {
    DB: { value: database(env.DB), enumerable: true },
    R2: { value: bucket(env.R2), enumerable: true },
    PUBLIC_COVERS: { value: env.PUBLIC_COVERS && bucket(env.PUBLIC_COVERS), enumerable: true },
  });
}
