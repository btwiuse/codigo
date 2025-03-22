import "@polkadot/types-augment";
import {
  InjectedAccount,
  InjectedAccounts,
  InjectedMetadata,
  InjectedProvider,
  MetadataDef,
} from "@polkadot/extension-inject/types";

export class PolkadotBridge {
  private port: MessagePort;
  private pending = new Map<number, { resolve: Function; reject: Function }>();
  private subscriptions = new Map<string, Function>();
  private idCounter = 0;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.onmessage = this.handleMessage.bind(this);
  }

  private handleMessage(event: MessageEvent) {
    const { data } = event;

    if (data.type === "bridge-response") {
      const handler = this.pending.get(data.id);
      if (handler) {
        data.error
          ? handler.reject(new Error(data.error))
          : handler.resolve(data.result);
        this.pending.delete(data.id);
      }
    }

    if (data.type === "bridge-update") {
      const callback = this.subscriptions.get(data.subId);
      callback?.(data.result);
    }
  }

  private sendCommand(path: string[], args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.idCounter++;
      this.pending.set(id, { resolve, reject });

      this.port.postMessage({
        type: "bridge-command",
        id,
        path,
        args: JSON.parse(JSON.stringify(args)), // Cloneable data only
      });
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        if (event.data.cmd === "CONNECT_SUCCESS") resolve();
        if (event.data.cmd === "CONNECT_ERROR") {
          reject(new Error(event.data.error));
        }
        this.port.removeEventListener("message", handler);
      };

      this.port.addEventListener("message", handler);
      this.port.postMessage({ cmd: "CONNECT" });
    });
  }

  // Accounts API
  get accounts() {
    return {
      get: (anyType?: boolean) =>
        this.sendCommand(["accounts", "get"], [anyType]),
      subscribe: (callback: (accounts: InjectedAccount[]) => void) => {
        const subId = `sub-${Date.now()}-${Math.random()}`;

        this.port.postMessage({
          type: "bridge-subscribe",
          subId,
        });

        this.subscriptions.set(subId, callback);

        return () => {
          this.port.postMessage({
            type: "bridge-unsubscribe",
            subId,
          });
          this.subscriptions.delete(subId);
        };
      },
    };
  }

  // Signer API
  get signer() {
    return {
      signRaw: (options: { address: string; data: string }) =>
        this.sendCommand(["signer", "signRaw"], [options]),
      signPayload: (payload: any) =>
        this.sendCommand(["signer", "signPayload"], [payload]),
    };
  }

  // Metadata API
  get metadata() {
    return {
      get: () => this.sendCommand(["metadata", "get"], []),
      provide: (definition: MetadataDef) =>
        this.sendCommand(["metadata", "provide"], [definition]),
    };
  }

  // Provider API
  get provider() {
    return {
      listProviders: () => this.sendCommand(["provider", "listProviders"], []),
      startProvider: (key: string) =>
        this.sendCommand(["provider", "startProvider"], [key]),
    };
  }
}
