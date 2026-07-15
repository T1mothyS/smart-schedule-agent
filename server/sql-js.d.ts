declare module 'sql.js' {
  export class Database {
    constructor(data?: Uint8Array);
    run(sql: string, params?: unknown[]): void;
    prepare(sql: string): {
      bind(params: unknown[]): void;
      step(): boolean;
      getAsObject(): Record<string, unknown>;
      free(): void;
    };
    getRowsModified(): number;
    export(): Uint8Array;
  }

  const initSqlJs: () => Promise<{
    Database: typeof Database;
  }>;
  export default initSqlJs;
}
