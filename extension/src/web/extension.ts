import * as vscode from "vscode";
import { HostFS } from "./hostfs.js";
import { createTerminal } from "./terminal.js";
import { PolkadotBridge } from "./polkadotBridge.js";

//@ts-ignore
import * as duplex from "../duplex/duplex.min.js";

declare const navigator: unknown;

export async function activate(context: vscode.ExtensionContext) {
  if (typeof navigator !== "object") { // do not run under node.js
    console.error("not running in browser");
    return;
  }

  // Usage
  const chan = new MessageChannel();
  const bridge = new PolkadotBridge(chan.port1);

  // Post port to webview
  self.postMessage({ type: "_bridge_port", port: chan.port2 }, [chan.port2]);

  // Connect and use
  bridge.connect()
    .then(async () => {
      const accounts = await bridge.accounts.get(true);
      console.log("got", { accounts });
      const unsubscribe = bridge.accounts.subscribe((accounts) => {
        console.log("Accounts updated:", accounts);
      });

      const signature = await bridge.signer.signRaw({
        address: accounts[0].address,
        data: "Hello World",
      });
      console.log("signature", { signature });
    })
    .catch((error) => console.error("Connection failed:", error));

  const channel = new MessageChannel();
  self.postMessage({ type: "_port", port: channel.port2 }, [channel.port2]);

  const sess = new duplex.Session(new duplex.PortConn(channel.port1));
  const peer = new duplex.Peer(sess, new duplex.CBORCodec());
  peer.respond();

  const fs = new HostFS(peer);
  context.subscriptions.push(fs);

  const terminal = createTerminal(peer);

  // Register command to create new terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.createNewTerminal", async () => {
      const newTerminal = createTerminal(peer);
    }),
  );
}
