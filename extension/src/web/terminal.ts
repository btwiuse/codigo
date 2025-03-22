import * as vscode from "vscode";

export function createTerminal(peer: any) {
  return vscode.window.createTerminal({
    name: `Terminal`,
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
