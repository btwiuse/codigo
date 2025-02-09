import * as vscode from "vscode";
import { HostFS } from "./hostfs.js";

//@ts-ignore
import * as duplex from "../duplex/duplex.min.js";

declare const navigator: unknown;

export async function activate(context: vscode.ExtensionContext) {
  if (typeof navigator !== "object") { // do not run under node.js
    console.error("not running in browser");
    return;
  }

  const channel = new MessageChannel();
  self.postMessage({ type: "_port", port: channel.port2 }, [channel.port2]);

  const sess = new duplex.Session(new duplex.PortConn(channel.port1));
  const peer = new duplex.Peer(sess, new duplex.CBORCodec());
  peer.respond();

  const fs = new HostFS(peer);
  context.subscriptions.push(fs);

  const terminal = createTerminal(peer);
  terminal.show();

  // Register command to create new terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.createNewTerminal", () => {
      const newTerminal = createTerminal(peer);
      newTerminal.show();
    }),
  );
}

function createTerminal(peer: any) {
  const writeEmitter = new vscode.EventEmitter<string>();
  let channel: any = undefined;
  let log = vscode.window.createOutputChannel("go-vscode");
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    open: (initialDimensions: vscode.TerminalDimensions | undefined) => {
      (async () => {
        const resp = await peer.call("vscode.Terminal");
        channel = resp.channel;
        if (initialDimensions && channel) {
          const { columns, rows } = initialDimensions;
          let payload = JSON.stringify({
            "version": 2,
            "width": columns,
            "height": rows,
            "cmd": ["/bin/bash"],
            "env": {
              "TERM": "xterm-256color",
              "FOO": "BAR",
            },
          });
          // log.appendLine(`open: ${payload}`);
          channel.write(enc.encode(payload + "\n"));
        }
        const b = new Uint8Array(65536);
        let gotEOF = false;
        while (gotEOF === false) {
          const n = await channel.read(b);
          if (n === null) {
            gotEOF = true;
          } else {
            let recv = dec.decode(b.subarray(0, n));
            // log.appendLine(`recv: ${recv.length}`);
            try {
              let [, , out] = JSON.parse(recv);
              writeEmitter.fire(out);
            } catch (e) {
              log.appendLine(`error: ${e}, len(recv): ${recv.length}`);
            }
          }
        }
      })();
    },
    close: () => {
      if (channel) {
        channel.close();
      }
    },
    handleInput: (data: string) => {
      if (channel) {
        let payload = JSON.stringify([0, "i", data]);
        // log.appendLine(`handleInput: ${payload}`);
        channel.write(enc.encode(payload + "\n"));
      }
    },
    setDimensions: (dimensions: vscode.TerminalDimensions) => {
      if (channel) {
        const { columns, rows } = dimensions;
        let payload = JSON.stringify({
          "version": 2,
          "width": columns,
          "height": rows,
        });
        // log.appendLine(`setDimensions: ${payload}`);
        channel.write(enc.encode(payload + "\n"));
      }
    },
  };
  return vscode.window.createTerminal({ name: `Shell`, pty });
}
