/*
var injected;

window.addEventListener("message", (event) => {
  const { data } = event;
  if (data.source === "react-devtools-content-script") {
    return;
  }
  if (data.type === "_bridge") {
    console.log("_BRIDGE", JSON.stringify(event.data, null, "  "), event);
  }
  if (data.type === "_bridge_port" && event.ports.length > 0) {
    console.log("_BRIDGE_PORT", JSON.stringify(event.data, null, "  "), event);
    const port = event.ports[0];
    port.onmessage = (event) => {
      const { data } = event;
      console.log("<<", data);
      if (data.cmd === "SIGN_RAW") {
        injected.signer.signRaw({ address: data.address, data: data.data }).then(
          (result) => {
            port.postMessage({ type: "_bridge_port", cmd: data.cmd, result });
          },
        );
      }
      if (data.cmd === "ENABLE") {
        windowInjectedWeb3().enable("bridge").then((app) => {
          injected = app;
          injected.accounts.subscribe((addrs) => {
            port.postMessage({ type: "_bridge_port", cmd: data.cmd, addrs });
          });
        });
      }
    };
  }
});
*/

const extensionReady = new Promise((resolve) => {
  window.addEventListener("message", (event) => {
    const { data } = event;
    if (data.type !== "_port" || !data.from || !data.port) {
      return;
    }
    console.log("_PORT", JSON.stringify(event.data, null, "  "));
    resolve(data.port);
  });
});

const websocketReady = new Promise((resolve) => {
  const ws = new WebSocket(`//${location.host}/bridge`);
  ws.onopen = (e) => {
    resolve(ws);
  };
});

Promise.all([websocketReady, extensionReady]).then(([ws, extPort]) => {
  ws.onmessage = async (event) => {
    const data = await blobToUint8Array(event.data);
    // console.log(">>", data);
    extPort.postMessage(data);
  };
  extPort.onmessage = (event) => {
    // console.log("<<", event.data);
    ws.send(event.data);
  };
  // console.log("bridged");
});

function blobToUint8Array(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function () {
      const arrayBuffer = reader.result;
      const uint8Array = new Uint8Array(arrayBuffer);
      resolve(uint8Array);
    };
    reader.onerror = function (error) {
      reject(error);
    };
    reader.readAsArrayBuffer(blob);
  });
}

function createBridgeHandler(port, app) {
  let idCounter = 0;
  const pending = new Map();
  const subscriptions = new Map();

  async function handleCommand(path, args) {
    let current = app;
    for (const part of path) {
      current = current[part];
      if (!current) throw new Error(`Invalid path: ${path.join(".")}`);
    }

    if (typeof current !== "function") {
      return current;
    }

    return current(...args);
  }

  port.onmessage = async (event) => {
    const { data } = event;

    // Handle method calls
    if (data.type === "bridge-command") {
      try {
        console.log("bridge-command", data.path, data.args);
        const result = await handleCommand(data.path, data.args);
        port.postMessage({
          type: "bridge-response",
          id: data.id,
          result: JSON.parse(JSON.stringify(result)), // Simple serialization
        });
      } catch (error) {
        console.log("bridge-command-error", error);
        port.postMessage({
          type: "bridge-response",
          id: data.id,
          error: error.message,
        });
      }
    }

    // Handle subscriptions
    if (data.type === "bridge-subscribe") {
      const unsub = app.accounts.subscribe((accounts) => {
        port.postMessage({
          type: "bridge-update",
          subId: data.subId,
          result: JSON.parse(JSON.stringify(accounts)),
        });
      });

      subscriptions.set(data.subId, unsub);
    }

    if (data.type === "bridge-unsubscribe") {
      const unsub = subscriptions.get(data.subId);
      if (unsub) {
        unsub();
        subscriptions.delete(data.subId);
      }
    }
  };
}

function windowInjectedWeb3() {
  if (!window.injectedWeb3 || Object.keys(window.injectedWeb3).length === 0) {
    console.error("InjectedWeb3 not found");
  }
  if ("subwallet-js" in window.injectedWeb3) {
    return window.injectedWeb3["subwallet-js"];
  }
  if ("polkadot-js" in window.injectedWeb3) {
    return window.injectedWeb3["polkadot-js"];
  }
  return window.injectedWeb3[Object.keys(window.injectedWeb3)[0]];
}

window.addEventListener("message", (event) => {
  if (event.data.type === "_bridge_port" && event.ports.length > 0) {
    const port = event.ports[0];

    port.onmessage = async (event) => {
      const { data } = event;

      if (data.cmd === "CONNECT") {
        try {
          const app = await windowInjectedWeb3().enable(
            "bridge",
          );
          createBridgeHandler(port, app);
          port.postMessage({ cmd: "CONNECT_SUCCESS" });
        } catch (error) {
          port.postMessage({ cmd: "CONNECT_ERROR", error: error.message });
        }
      }
    };
  }
});
