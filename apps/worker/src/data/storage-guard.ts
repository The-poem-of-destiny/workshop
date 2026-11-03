import { withWriteBarrier } from "../write-barrier";
import type { DataEnv } from "./env";

export function guardedStorageEnv(env: DataEnv): DataEnv {
  const statements = new WeakMap<object, object>();

  function invoke<T>(target: object, property: PropertyKey, args: unknown[]): T {
    return Reflect.apply(Reflect.get(target, property, target) as (...args: unknown[]) => T, target, args);
  }

  async function guarded<T>(kind: string, operation: () => Promise<T>): Promise<T> {
    const result = await withWriteBarrier(env, kind, operation);
    if (!result.admitted) throw new Error("Maintenance barrier closed or unavailable");
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
    statements.set(proxy, target);
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
            const unwrapped = batch.map((item) => {
              const original = statements.get(item);
              if (!original) throw new Error("D1 batch contains an unguarded statement");
              return original;
            });
            return guarded("d1.batch", () => invoke<Promise<unknown>>(object, property, [unwrapped]));
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

  const bucket = new Proxy(env.R2, {
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

  return Object.defineProperties(Object.create(env), {
    DB: { value: database(env.DB), enumerable: true },
    R2: { value: bucket, enumerable: true },
  });
}
