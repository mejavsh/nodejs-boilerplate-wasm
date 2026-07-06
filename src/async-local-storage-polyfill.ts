/**
 * AsyncLocalStorage polyfill for single-threaded WASM environments.
 *
 * In Spin WASM, requests are handled sequentially (one at a time).
 * The store set by `run()` persists until the next `run()` / `enterWith()` call,
 * which avoids the store being lost when concurrent async React renders race
 * against Promise-based restore callbacks.
 */
export class AsyncLocalStorage<T> {
  private _store: T | undefined = undefined;

  getStore(): T | undefined {
    return this._store;
  }

  run<R>(store: T, callback: (...args: any[]) => R, ...args: any[]): R {
    this._store = store;
    return callback(...args);
  }

  exit<R>(callback: (...args: any[]) => R, ...args: any[]): R {
    this._store = undefined;
    return callback(...args);
  }

  enterWith(store: T): void {
    this._store = store;
  }

  disable(): void {
    this._store = undefined;
  }

  static bind<Func extends (...args: any[]) => any>(fn: Func): Func {
    return fn;
  }

  static snapshot(): <R, TArgs extends any[]>(fn: (...args: TArgs) => R, ...args: TArgs) => R {
    return (fn, ...args) => fn(...args);
  }
}

export default { AsyncLocalStorage };
