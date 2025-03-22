import * as vscode from "vscode";
import { HostFS } from "./hostfs.js";
import { PolkadotBridge } from "./polkadotBridge.js";

//@ts-ignore
import * as duplex from "../duplex/duplex.min.js";

declare const navigator: unknown;

export async function activate(context: vscode.ExtensionContext) {
  if (typeof navigator !== "object") { // do not run under node.js
    console.error("not running in browser");
    return;
  }

  /*
  // vscode extension injectedWeb3 bridge starts
  self.postMessage({
    type: "_bridge",
    text: "hello",
    ethereum: !!(globalThis as any).ethereum,
    injectedWeb3: !!(globalThis as any).injectedWeb3,
  });

  const chan = new MessageChannel();
  self.postMessage({
    type: "_bridge_port",
    text: "hello port",
    ethereum: !!(globalThis as any).ethereum,
    injectedWeb3: !!(globalThis as any).injectedWeb3,
    port: chan.port2,
  }, [chan.port2]);
  chan.port1.onmessage = async (ev: MessageEvent) => {
    console.log("port1", ev.data);
    if (ev.data.cmd === "ENABLE" && ev.data.addrs.length > 0) {
      const addrsNumber = ev.data.addrs.length;
      const addrsJSON = JSON.stringify(
        ev.data.addrs.map((a: any) => a.address),
        null,
        "  ",
      );
      vscode.window.showInformationMessage(
        `${addrsNumber} accounts found: ${addrsJSON}`,
      );
      chan.port1.postMessage({
        cmd: "SIGN_RAW",
        address: ev.data.addrs[0].address,
        data: "Hello bridge!",
      });
    }
    if (ev.data.cmd === "SIGN_RAW" && ev.data.result) {
      vscode.window.showInformationMessage(
        `Signature: ${ev.data.result.signature}`,
      );
    }
  };
  setTimeout(() => {
    chan.port1.postMessage({ cmd: "ENABLE" });
    console.log("port1 sent ENABLE");
  }, 2000);
  // vscode extension injectedWeb3 bridge ends
  */

  // Usage
  const chan = new MessageChannel();
  const bridge = new PolkadotBridge(chan.port1);

  // Post port to webview
  self.postMessage({ type: "_bridge_port", port: chan.port2 }, [chan.port2]);

  // Connect and use
  bridge.connect()
    .then(async () => {
      const accounts = await bridge.accounts.get(true);
      console.log("got", {accounts});
      const unsubscribe = bridge.accounts.subscribe((accounts) => {
        console.log("Accounts updated:", accounts);
      });

      const signature = await bridge.signer.signRaw({
        address: accounts[0].address,
        data: "Hello World",
      });
      console.log("signature", {signature});
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
  // await vscode.commands.executeCommand( "workbench.action.terminal.moveToEditor",);

  // Register command to create new terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.createNewTerminal", async () => {
      const newTerminal = createTerminal(peer);
      // newTerminal.show();
      // await vscode.commands.executeCommand( "workbench.action.terminal.moveToEditor",);
    }),
  );

  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider(
      "extension.terminal-profile",
      {
        provideTerminalProfile(token) {
          return {
            options: {
              name: "bash",
              pty: newPty(peer),
              // location: vscode.TerminalLocation.Editor,
              // isTransient: false,
            },
          };
        },
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.createNewTerminal2",
      async () => {
        vscode.window.showInformationMessage(
          `appHost: ${vscode.env.appHost}
appName: ${vscode.env.appName}
appRoot: ${vscode.env.appRoot}
isNewAppInstall: ${vscode.env.isNewAppInstall}
isTelemetryEnabled: ${vscode.env.isTelemetryEnabled}
language: ${vscode.env.language}
logLevel: ${vscode.env.logLevel}
machineId: ${vscode.env.machineId}
remoteName: ${vscode.env.remoteName}
sessionId: ${vscode.env.sessionId}
shell: ${vscode.env.shell}
uiKind: ${vscode.env.uiKind}
uriScheme: ${vscode.env.uriScheme}`,
        );
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.createNewTerminal3",
      async () => {
        vscode.window.createTerminal({
          name: `EchoShell`,
          pty: echoPty(),
          location: vscode.TerminalLocation.Editor,
        });
      },
    ),
  );
}

function createTerminal(peer: any) {
  return vscode.window.createTerminal({
    name: `WebShell`,
    pty: newPty(peer),
    location: vscode.TerminalLocation.Editor,
  });
}

function newPty(peer: any): vscode.Pseudoterminal {
  const writeEmitter = new vscode.EventEmitter<string>();
  let channel: any = undefined;
  let log = vscode.window.createOutputChannel("go-vscode");
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  return {
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
}

function echoPty(): vscode.Pseudoterminal {
  const writeEmitter = new vscode.EventEmitter<string>();
  let log = vscode.window.createOutputChannel("go-vscode-echo");
  return {
    onDidWrite: writeEmitter.event,
    open: (initialDimensions: vscode.TerminalDimensions | undefined) => {
      (async () => {
        if (initialDimensions) {
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
          log.appendLine(`open: ${payload}`);
        }
      })();
    },
    close: () => {
      log.appendLine(`close`);
    },
    handleInput: (data: string) => {
      let payload = JSON.stringify([0, "i", data]);
      writeEmitter.fire(data);
      log.appendLine(`handleInput: ${payload}`);
    },
    setDimensions: (dimensions: vscode.TerminalDimensions) => {
      const { columns, rows } = dimensions;
      let payload = JSON.stringify({
        "version": 2,
        "width": columns,
        "height": rows,
      });
      log.appendLine(`setDimensions: ${payload}`);
    },
  };
}
